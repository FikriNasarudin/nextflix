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
	default:
		return "540p"
	}
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

	if _, err := h.sm.GetOrCreate(id, filePath, "480p", "transcode", pos); err != nil {
		log.Printf("Transcode: failed to start 480p for media=%d pos=%d: %v", id, pos, err)
		writeError(w, "Server is busy. Please try again in a moment.", http.StatusServiceUnavailable)
		return
	}

	master := "#EXTM3U\n"
	master += fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480\n480p/index.m3u8?pos=%d\n", pos)

	var codec string
	var width, height, isHdr int
	var bitRate string
	h.db.QueryRow(`SELECT codec, width, height, bit_rate, is_hdr FROM media_video_tracks WHERE media_id = ? AND is_default = 1`, id).Scan(&codec, &width, &height, &bitRate, &isHdr)

	if codec == "h264" && isHdr == 0 && height > 480 {
		label := labelForHeight(height)
		if width <= 0 {
			width = height * 16 / 9
		}
		bw := parseBitrate(bitRate, 4000000)

		if _, err := h.sm.GetOrCreate(id, filePath, label, "remux", pos); err != nil {
			log.Printf("Transcode: failed to start remux %s for media=%d pos=%d: %v", label, id, pos, err)
		} else {
			master += fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d\n%s/index.m3u8?pos=%d\n", bw, width, height, label, pos)
		}
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
		if found && (rendition == "480p" || rendition == "1080p" || rendition == "720p" || rendition == "1440p" || rendition == "2160p" || rendition == "540p") {
			kind := "transcode"
			if rendition != "480p" {
				kind = "remux"
			}
			var fp string
			h.db.QueryRow(`SELECT file_path FROM media_items WHERE id = ?`, id).Scan(&fp)
			if fp != "" {
				if _, err := h.sm.GetOrCreate(id, fp, rendition, kind, pos); err != nil {
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
