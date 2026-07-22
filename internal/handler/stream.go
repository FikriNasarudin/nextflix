package handler

import (
	"bytes"
	"context"
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

var (
	hasFFprobe bool
	hasFFmpeg  bool
)

func init() {
	_, e1 := exec.LookPath("ffprobe")
	hasFFprobe = e1 == nil
	_, e2 := exec.LookPath("ffmpeg")
	hasFFmpeg = e2 == nil
}

type StreamHandler struct {
	db           *sql.DB
	hlsOutputDir string
	transcodeSem chan struct{}
}

func NewStreamHandler(db *sql.DB, hlsOutputDir string, maxTranscodes int) *StreamHandler {
	sem := make(chan struct{}, maxTranscodes)
	for i := 0; i < maxTranscodes; i++ {
		sem <- struct{}{}
	}
	return &StreamHandler{db: db, hlsOutputDir: hlsOutputDir, transcodeSem: sem}
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
	if !hasFFprobe || !hasFFmpeg {
		http.Error(w, "ffmpeg/ffprobe not available", http.StatusInternalServerError)
		return
	}

	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	select {
	case <-h.transcodeSem:
	default:
		http.Error(w, "transcode slot busy, try another source", http.StatusServiceUnavailable)
		return
	}
	defer func() { h.transcodeSem <- struct{}{} }()

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

	codec := lookupCodec(h.db, id, filePath)
	if codec == "" {
		http.Error(w, "video codec detection failed", http.StatusInternalServerError)
		return
	}
	tryCopy := codec == "h264"

	audioIdxStr := r.URL.Query().Get("audio_index")
	audioMap := ""
	if audioIdxStr != "" {
		if ai, err := strconv.Atoi(audioIdxStr); err == nil && ai >= 0 {
			audioMap = fmt.Sprintf("0:a:%d", ai)
		}
	}

	var cmd *exec.Cmd
	if tryCopy {
		args := []string{"-i", filePath}
		if audioMap != "" {
			args = append(args, "-map", "0:v:0", "-map", audioMap)
		}
		args = append(args,
			"-c:v", "copy",
			"-c:a", "aac",
			"-b:a", "128k",
			"-ar", "48000",
			"-ac", "2",
			"-sn",
			"-fflags", "+genpts",
			"-movflags", "frag_keyframe+empty_moov",
			"-f", "mp4",
			"pipe:1",
		)
		cmd = exec.CommandContext(r.Context(), "ffmpeg", args...)
	} else {
		log.Printf("Remux: transcoding id=%d codec=%s to h264", id, codec)
		args := []string{"-i", filePath}
		if audioMap != "" {
			args = append(args, "-map", "0:v:0", "-map", audioMap)
		}
		args = append(args,
			"-c:v", "libx264",
			"-preset", "veryfast",
			"-profile:v", "baseline",
			"-level", "3.0",
			"-pix_fmt", "yuv420p",
			"-crf", "28",
			"-c:a", "aac",
			"-b:a", "128k",
			"-ar", "48000",
			"-ac", "2",
			"-sn",
			"-fflags", "+genpts",
			"-movflags", "frag_keyframe+empty_moov",
			"-f", "mp4",
			"pipe:1",
		)
		cmd = exec.CommandContext(r.Context(), "ffmpeg", args...)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		http.Error(w, "ffmpeg error", http.StatusInternalServerError)
		return
	}

	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		stdout.Close()
		log.Printf("Remux: start failed for id=%d: %v, stderr: %s", id, err, stderrBuf.String())
		http.Error(w, "ffmpeg error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "video/mp4")

	n, copyErr := io.Copy(w, stdout)

	if err := cmd.Wait(); err != nil {
		log.Printf("Remux: ffmpeg failed for id=%d codec=%s tryCopy=%t: %v", id, codec, tryCopy, err)
		log.Printf("Remux: ffmpeg stderr: %s", stderrBuf.String())
	}
	if copyErr != nil {
		log.Printf("Remux: copy error for id=%d: %v (copied %d bytes)", id, copyErr, n)
	}
}

func lookupCodec(db *sql.DB, id int64, filePath string) string {
	var codec string
	err := db.QueryRow(`SELECT codec FROM media_video_tracks WHERE media_id = ? AND is_default = 1`, id).Scan(&codec)
	if err == nil && codec != "" {
		return codec
	}
	c := probeVideoCodec(filePath)
	if c != "" {
		db.Exec(`INSERT OR IGNORE INTO media_video_tracks (media_id, codec, is_default) VALUES (?, ?, 1)`, id, c)
	}
	return c
}

func probeVideoCodec(filePath string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "quiet",
		"-select_streams", "v:0",
		"-show_entries", "stream=codec_name",
		"-of", "csv=p=0",
		filePath,
	)
	out, err := cmd.Output()
	if err != nil {
		log.Printf("Remux: ffprobe failed for %s: %v", filePath, err)
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

	rest := r.PathValue("rest")
	if rest == "" || strings.Contains(rest, "..") {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	absBase, err := filepath.Abs(h.hlsOutputDir)
	if err != nil {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	absBase, err = filepath.EvalSymlinks(absBase)
	if err != nil {
		absBase, _ = filepath.Abs(h.hlsOutputDir)
	}

	filePath := filepath.Join(absBase, fmt.Sprintf("%d", id), rest)
	absPath, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		absPath, err = filepath.Abs(filePath)
		if err != nil {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}
	}

	if !strings.HasPrefix(absPath, absBase+string(filepath.Separator)) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	ext := strings.ToLower(filepath.Ext(absPath))
	if ext == ".ts" {
		w.Header().Set("Content-Type", "video/mp2t")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFile(w, r, absPath)
		return
	}

	if ext != ".m3u8" {
		http.ServeFile(w, r, absPath)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		ah := r.Header.Get("Authorization")
		if strings.HasPrefix(ah, "Bearer ") {
			token = strings.TrimPrefix(ah, "Bearer ")
		}
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
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

	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(data)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON: encode error: %v", err)
	}
}

func writeError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
