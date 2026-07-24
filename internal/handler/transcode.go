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

	"nextflix/internal/transcoder"
)

type TranscodeHandler struct {
	db     *sql.DB
	sm     *transcoder.SessionManager
	shmDir string
}

func NewTranscodeHandler(db *sql.DB, sm *transcoder.SessionManager) *TranscodeHandler {
	return &TranscodeHandler{db: db, sm: sm, shmDir: "/dev/shm/homestream"}
}

func (h *TranscodeHandler) Master(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	var filePath string
	if err := h.db.QueryRow(`SELECT file_path FROM media_items WHERE id = ?`, id).Scan(&filePath); err != nil {
		writeError(w, "not found", http.StatusNotFound)
		return
	}

	var codec string
	h.db.QueryRow(`SELECT codec FROM media_video_tracks WHERE media_id = ? AND is_default = 1`, id).Scan(&codec)

	var bw480p, bw1080p string
	res480p, res1080p := "854x480", "1920x1080"

	if codec == "h264" {
		bw480p = "1000000"
		bw1080p = "5000000"
	} else {
		bw480p = "1000000"
		bw1080p = "5000000"
	}

	master := "#EXTM3U\n"
	master += fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%s,RESOLUTION=%s\n480p.m3u8\n", bw480p, res480p)
	master += fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%s,RESOLUTION=%s\n1080p.m3u8\n", bw1080p, res1080p)

	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write([]byte(master))

	// Start the 480p session immediately
	go func() {
		if _, err := h.sm.GetOrCreate(id, filePath, "480p"); err != nil {
			log.Printf("Transcode: failed to start 480p for media=%d: %v", id, err)
		}
	}()
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

	ext := strings.ToLower(filepath.Ext(absPath))
	if ext == ".ts" {
		w.Header().Set("Content-Type", "video/mp2t")
	} else if ext == ".m3u8" {
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	} else if ext == ".vtt" {
		w.Header().Set("Content-Type", "text/vtt")
	}

	if ext == ".m3u8" {
		data, err := os.ReadFile(absPath)
		if err != nil {
			writeError(w, "not found", http.StatusNotFound)
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
			param := "?token=" + token
			lines := strings.Split(string(data), "\n")
			for i, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "#") {
					continue
				}
				if strings.Contains(line, "://") {
					continue
				}
				if strings.Contains(line, "?") {
					lines[i] = line + "&token=" + token
				} else {
					lines[i] = line + param
				}
			}
			data = []byte(strings.Join(lines, "\n"))
		}

		w.Header().Set("Cache-Control", "no-cache")
		w.Write(data)
		return
	}

	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFile(w, r, absPath)
}
