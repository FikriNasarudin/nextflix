package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type StreamHandler struct {
	db          *sql.DB
	hlsOutputDir string
}

func NewStreamHandler(db *sql.DB, hlsOutputDir string) *StreamHandler {
	return &StreamHandler{db: db, hlsOutputDir: hlsOutputDir}
}

func (h *StreamHandler) Serve(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var filePath string
	err = h.db.QueryRow(`SELECT file_path FROM media_items WHERE id = ?`, id).Scan(&filePath)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}

	file, err := os.Open(filePath)
	if err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		http.Error(w, "file error", http.StatusInternalServerError)
		return
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	mime := map[string]string{
		".mp4": "video/mp4", ".mkv": "video/x-matroska",
		".avi": "video/x-msvideo", ".mov": "video/quicktime",
		".webm": "video/webm", ".ts": "video/mp2t",
		".m4v": "video/mp4", ".ogv": "video/ogg",
	}
	if ct, ok := mime[ext]; ok {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, filepath.Base(filePath), stat.ModTime(), file)
}

func (h *StreamHandler) Remux(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var filePath string
	err = h.db.QueryRow(`SELECT file_path FROM media_items WHERE id = ?`, id).Scan(&filePath)
	if err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}

	if _, err := exec.LookPath("ffmpeg"); err != nil {
		http.Error(w, "ffmpeg not available", http.StatusInternalServerError)
		return
	}

	cmd := exec.Command("ffmpeg",
		"-i", filePath,
		"-c", "copy",
		"-movflags", "frag_keyframe+empty_moov",
		"-f", "mp4",
		"pipe:1",
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		http.Error(w, "ffmpeg error", http.StatusInternalServerError)
		return
	}
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		http.Error(w, "ffmpeg error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Transfer-Encoding", "chunked")
	w.WriteHeader(http.StatusOK)

	io.Copy(w, stdout)
	cmd.Wait()
}

func (h *StreamHandler) HLSFile(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join(h.hlsOutputDir, fmt.Sprintf("%d", id), r.PathValue("rest"))

	if ext := filepath.Ext(filePath); ext == ".ts" {
		w.Header().Set("Content-Type", "video/MP2T")
		w.Header().Set("Cache-Control", "public, max-age=86400")
	} else if ext == ".m3u8" {
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	}

	http.ServeFile(w, r, filePath)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	fmt.Fprintf(w, `{"error":"%s"}`, msg)
}
