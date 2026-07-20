package handler

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
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

	if _, err := exec.LookPath("ffprobe"); err != nil {
		http.Error(w, "ffprobe not available", http.StatusInternalServerError)
		return
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		http.Error(w, "ffmpeg not available", http.StatusInternalServerError)
		return
	}

	codec := probeVideoCodec(filePath)
	tryCopy := codec == "h264" || codec == "hevc" || codec == ""

	var cmd *exec.Cmd
	if tryCopy {
		cmd = exec.Command("ffmpeg",
			"-i", filePath,
			"-c:v", "copy",
			"-c:a", "aac",
			"-sn",
			"-fflags", "+genpts",
			"-movflags", "frag_keyframe+empty_moov",
			"-f", "mp4",
			"pipe:1",
		)
	} else {
		log.Printf("Remux: transcoding id=%d codec=%s to h264", id, codec)
		cmd = exec.Command("ffmpeg",
			"-i", filePath,
			"-c:v", "libx264",
			"-preset", "veryfast",
			"-crf", "28",
			"-c:a", "aac",
			"-sn",
			"-fflags", "+genpts",
			"-movflags", "frag_keyframe+empty_moov",
			"-f", "mp4",
			"pipe:1",
		)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		http.Error(w, "ffmpeg error", http.StatusInternalServerError)
		return
	}

	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		log.Printf("Remux: start failed for id=%d: %v, stderr: %s", id, err, stderrBuf.String())
		http.Error(w, "ffmpeg error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Transfer-Encoding", "chunked")
	w.WriteHeader(http.StatusOK)

	io.Copy(w, stdout)

	if err := cmd.Wait(); err != nil {
		log.Printf("Remux: ffmpeg failed for id=%d codec=%s tryCopy=%t: %v", id, codec, tryCopy, err)
		log.Printf("Remux: ffmpeg stderr: %s", stderrBuf.String())
	}
}

func probeVideoCodec(filePath string) string {
	cmd := exec.Command("ffprobe",
		"-v", "quiet",
		"-select_streams", "v:0",
		"-show_entries", "stream=codec_name",
		"-of", "csv=p=0",
		filePath,
	)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (h *StreamHandler) HLSFile(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join(h.hlsOutputDir, fmt.Sprintf("%d", id), r.PathValue("rest"))

	ext := filepath.Ext(filePath)
	if ext == ".ts" {
		w.Header().Set("Content-Type", "video/MP2T")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFile(w, r, filePath)
		return
	}

	if ext != ".m3u8" {
		http.ServeFile(w, r, filePath)
		return
	}

	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")

	token := r.URL.Query().Get("token")
	if token == "" {
		http.ServeFile(w, r, filePath)
		return
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}

	lines := strings.Split(string(data), "\n")
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.Contains(line, "://") {
			continue
		}
		if strings.Contains(line, "?") {
			lines[i] = line + "&token=" + token
		} else {
			lines[i] = line + "?token=" + token
		}
	}

	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, "index.m3u8", time.Time{}, strings.NewReader(strings.Join(lines, "\n")))
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
