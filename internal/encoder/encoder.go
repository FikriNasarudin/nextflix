package encoder

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"nextflix/internal/config"
	"nextflix/internal/scanner"
)

type Encoder struct {
	db        *sql.DB
	cfg       config.EncoderConfig
	jobCh     <-chan scanner.EncoderJob
}

func New(db *sql.DB, cfg config.EncoderConfig, jobCh <-chan scanner.EncoderJob) *Encoder {
	return &Encoder{db: db, cfg: cfg, jobCh: jobCh}
}

func (e *Encoder) Start() {
	go e.worker()
	log.Println("Encoder: worker started")
}

func (e *Encoder) worker() {
	for job := range e.jobCh {
		if err := e.encode(job.MediaID, job.FilePath); err != nil {
			log.Printf("Encoder: failed media=%d: %v", job.MediaID, err)
		}
	}
}

func (e *Encoder) encode(mediaID int64, inputPath string) error {
	outputDir := filepath.Join(e.cfg.HLSOutputDir, fmt.Sprintf("%d", mediaID))

	if info, err := os.Stat(outputDir); err == nil && info.IsDir() {
		log.Printf("Encoder: HLS already exists for media=%d, skipping", mediaID)
		return nil
	}

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}

	playlistPath := filepath.Join(outputDir, "480p.m3u8")

	args := []string{
		"-n", "19",
		"ffmpeg",
		"-i", inputPath,
		"-vf", "scale=-2:480",
		"-c:v", "libx264",
		"-preset", e.cfg.FFmpegPreset,
		"-c:a", "aac",
		"-f", "hls",
		"-hls_time", fmt.Sprintf("%d", e.cfg.HLSSegmentDurationSec),
		"-hls_list_size", "0",
		playlistPath,
	}

	cmd := exec.Command("nice", args...)
	cmd.Stdout = nil
	cmd.Stderr = nil

	log.Printf("Encoder: encoding media=%d to 480p HLS", mediaID)

	if err := cmd.Run(); err != nil {
		os.RemoveAll(outputDir)
		return fmt.Errorf("ffmpeg: %w", err)
	}

	e.db.Exec(`UPDATE media_items SET hls_480p_path = ? WHERE id = ?`, playlistPath, mediaID)
	log.Printf("Encoder: complete media=%d → %s", mediaID, playlistPath)

	return nil
}
