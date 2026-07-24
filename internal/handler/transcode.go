package handler

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"nextflix/internal/transcoder"
)

type TranscodeHandler struct {
	db    *sql.DB
	sm    *transcoder.SessionManager
	shmDir string
}

func NewTranscodeHandler(db *sql.DB, sm *transcoder.SessionManager, shmDir string) *TranscodeHandler {
	return &TranscodeHandler{db: db, sm: sm, shmDir: shmDir}
}

func parsePos(r *http.Request) int {
	s := r.URL.Query().Get("pos")
	if s == "" {
		return 0
	}
	v, err := strconv.Atoi(s)
	if err != nil || v < 0 {
		return 0
	}
	return v
}

func labelForHeight(height int) string {
	switch {
	case height >= 2160:
		return "2160p"
	case height >= 1440:
		return "1440p"
	case height >= 1080:
		return "1080p"
	case height >= 720:
		return "720p"
	case height >= 540:
		return "540p"
	case height >= 480:
		return "480p"
	default:
		return "360p"
	}
}

func topLabelForHeight(height int) string {
	label := labelForHeight(height)
	// cap at 1080p per user request
	if height > 1080 {
		return "1080p"
	}
	return label
}

func parseBitrate(s string, fallback int) int {
	if s == "" || s == "N/A" {
		return fallback
	}
	v, err := strconv.Atoi(s)
	if err != nil || v <= 0 {
		return fallback
	}
	return v
}

// rungMetadata describes a single HLS rendition in the master playlist.
type rungMetadata struct {
	Label     string
	Kind      string
	Width     int
	Height    int
	Bandwidth int
	IsHdr     bool
}

// fixedRungs returns the always-present lower rungs that are transcoded.
func fixedRungs(isHdr bool) []rungMetadata {
	return []rungMetadata{
		{Label: "360p", Kind: "transcode", Width: 640, Height: 360, Bandwidth: 500000, IsHdr: isHdr},
		{Label: "480p", Kind: "transcode", Width: 854, Height: 480, Bandwidth: 800000, IsHdr: isHdr},
		{Label: "720p", Kind: "transcode", Width: 1280, Height: 720, Bandwidth: 2500000, IsHdr: isHdr},
	}
}

func (h *TranscodeHandler) Master(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	pos := parsePos(r)

	var filePath string
	if err := h.db.QueryRow(`SELECT file_path FROM media_items WHERE id = ?`, id).Scan(&filePath); err != nil {
		writeError(w, "not found", http.StatusNotFound)
		return
	}

	var codec string
	var width, height, isHdr int
	var bitRate string
	h.db.QueryRow(`SELECT codec, width, height, bit_rate, is_hdr FROM media_video_tracks WHERE media_id = ? AND is_default = 1`, id).Scan(&codec, &width, &height, &bitRate, &isHdr)

	isHdrBool := isHdr != 0

	// Always spawn lower transcode rungs
	var rungs []rungMetadata
	for _, r := range fixedRungs(isHdrBool) {
		if _, err := h.sm.GetOrCreateEx(id, filePath, r.Label, "transcode", pos, r.IsHdr); err != nil {
			log.Printf("Transcode: failed to start %s for media=%d pos=%d: %v", r.Label, id, pos, err)
			continue
		}
		rungs = append(rungs, r)
	}

	// Top rung: remux (h264 SDR) or transcode (HEVC/HDR/other) capped at 1080p
	canRemux := codec == "h264" && isHdr == 0 && height > 480
	if canRemux {
		label := topLabelForHeight(height)
		srcWidth := width
		if srcWidth <= 0 {
			srcWidth = height * 16 / 9
		}
		bw := parseBitrate(bitRate, 4000000)

		if _, err := h.sm.GetOrCreateEx(id, filePath, label, "remux", pos, false); err != nil {
			log.Printf("Transcode: failed to start remux %s for media=%d pos=%d: %v", label, id, pos, err)
		} else {
			rungs = append(rungs, rungMetadata{
				Label: label, Kind: "remux",
				Width: srcWidth, Height: height,
				Bandwidth: bw, IsHdr: false,
			})
		}
	} else {
		label := "1080p"
		bw := 4000000
		srcWidth := 1920

		if _, err := h.sm.GetOrCreateEx(id, filePath, label, "transcode", pos, isHdrBool); err != nil {
			log.Printf("Transcode: failed to start transcode %s for media=%d pos=%d: %v", label, id, pos, err)
		} else {
			rungs = append(rungs, rungMetadata{
				Label: label, Kind: "transcode",
				Width: srcWidth, Height: 1080,
				Bandwidth: bw, IsHdr: isHdrBool,
			})
		}
	}

	master := "#EXTM3U\n"
	for _, r := range rungs {
		master += fmt.Sprintf(
			"#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d\n%s/index.m3u8?pos=%d\n",
			r.Bandwidth, r.Width, r.Height, r.Label, pos,
		)
	}

	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write([]byte(master))
}

func (h *TranscodeHandler) Segment(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	rest := r.PathValue("rest")
	if rest == "" || strings.Contains(rest, "..") {
		writeError(w, "invalid path", http.StatusBadRequest)
		return
	}

	ext := strings.ToLower(filepath.Ext(rest))

	if ext == ".m3u8" {
		pos := parsePos(r)

		rendition, found := strings.CutSuffix(rest, "/index.m3u8")
		knownRenditions := map[string]bool{
			"360p": true, "480p": true, "540p": true,
			"720p": true, "1080p": true, "1440p": true, "2160p": true,
		}
		if found && knownRenditions[rendition] {
			var fp, codec string
			var isHdr int
			h.db.QueryRow(`SELECT file_path FROM media_items WHERE id = ?`, id).Scan(&fp)
			h.db.QueryRow(`SELECT COALESCE(codec,''), COALESCE(is_hdr,0) FROM media_video_tracks WHERE media_id = ? AND is_default = 1`, id).Scan(&codec, &isHdr)

			kind := "transcode"
			isHdrBool := isHdr != 0
			// Only try remux for h264 SDR source on the source-native label
			if rendition != "360p" && rendition != "480p" && rendition != "720p" && codec == "h264" && isHdr == 0 {
				kind = "remux"
				isHdrBool = false
			}

			if fp != "" {
				if _, err := h.sm.GetOrCreateEx(id, fp, rendition, kind, pos, isHdrBool); err != nil {
					log.Printf("Transcode: failed to start session media=%d rendition=%s pos=%d: %v", id, rendition, pos, err)
					writeError(w, "Server is busy. Please try again in a moment.", http.StatusServiceUnavailable)
					return
				}
			}
		}

		targetPath := filepath.Join(h.shmDir, fmt.Sprintf("%d", id), rendition, fmt.Sprintf("%d", pos), "index.m3u8")

		for i := 0; i < 150; i++ {
			if _, err := os.Stat(targetPath); err == nil {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}

		data, err := os.ReadFile(targetPath)
		if err != nil {
			log.Printf("Transcode: segment 404 media=%d rest=%s pos=%d: %v", id, rest, pos, err)
			writeError(w, "Server is busy. Please try again in a moment.", http.StatusServiceUnavailable)
			return
		}

		token := r.URL.Query().Get("token")
		if token == "" {
			ah := r.Header.Get("Authorization")
			if strings.HasPrefix(ah, "Bearer ") {
				token = strings.TrimPrefix(ah, "Bearer ")
			}
		}

		if token != "" {
			prefix := fmt.Sprintf("%d/", pos)
			lines := strings.Split(string(data), "\n")
			for i, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "#") {
					continue
				}
				if strings.Contains(line, "://") {
					continue
				}
				sep := "?"
				if strings.Contains(line, "?") {
					sep = "&"
				}
				lines[i] = prefix + line + sep + "token=" + token
			}
			data = []byte(strings.Join(lines, "\n"))
		}

		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(data)
		return
	}

	absBase := h.shmDir
	filePath := filepath.Join(absBase, fmt.Sprintf("%d", id), rest)
	absPath, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		absPath, err = filepath.Abs(filePath)
		if err != nil {
			writeError(w, "invalid path", http.StatusBadRequest)
			return
		}
	}

	if !strings.HasPrefix(absPath, absBase+string(filepath.Separator)) {
		writeError(w, "invalid path", http.StatusBadRequest)
		return
	}

	if ext == ".ts" {
		w.Header().Set("Content-Type", "video/mp2t")
	} else if ext == ".vtt" {
		w.Header().Set("Content-Type", "text/vtt")
	}

	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFile(w, r, absPath)
}
