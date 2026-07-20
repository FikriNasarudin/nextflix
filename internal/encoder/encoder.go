package encoder

import (
	"bytes"
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

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

type rendition struct {
	name    string
	res     string
	bitrate string
	maxrate string
	bufsize string
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

	renditions := []rendition{
		{name: "480p", res: "scale=-2:480", bitrate: "800k", maxrate: "1000k", bufsize: "1600k"},
		{name: "1080p", res: "scale=-2:1080", bitrate: "4000k", maxrate: "5000k", bufsize: "8000k"},
	}

	var wg sync.WaitGroup
	errCh := make(chan error, len(renditions))

	for _, r := range renditions {
		wg.Add(1)
		r := r
		go func() {
			defer wg.Done()
			segPattern := filepath.Join(outputDir, r.name+"_%03d.ts")
			playlist := filepath.Join(outputDir, r.name+".m3u8")
			args := []string{
				"-n", "19",
				"ffmpeg",
				"-i", inputPath,
				"-vf", r.res,
				"-c:v", "libx264",
				"-b:v", r.bitrate,
				"-maxrate", r.maxrate,
				"-bufsize", r.bufsize,
				"-preset", e.cfg.FFmpegPreset,
				"-threads", "1",
				"-max_muxing_queue_size", "1024",
				"-c:a", "aac",
				"-f", "hls",
				"-hls_time", fmt.Sprintf("%d", e.cfg.HLSSegmentDurationSec),
				"-hls_list_size", "0",
				"-hls_segment_filename", segPattern,
				playlist,
			}
			cmd := exec.Command("nice", args...)
			log.Printf("Encoder: encoding media=%d → %s (%s)", mediaID, r.name, r.bitrate)
			if err := cmd.Run(); err != nil {
				errCh <- fmt.Errorf("%s ffmpeg: %w", r.name, err)
			}
		}()
	}

	wg.Wait()
	close(errCh)

	var firstErr error
	for err := range errCh {
		if firstErr == nil {
			firstErr = err
		}
	}
	if firstErr != nil {
		os.RemoveAll(outputDir)
		return firstErr
	}

	playlistPath := filepath.Join(outputDir, "index.m3u8")
	var masterContent string
	masterContent += "#EXTM3U\n"
	for _, r := range renditions {
		bandwidth := "1000000"
		resolution := "854x480"
		if r.name == "1080p" {
			bandwidth = "5000000"
			resolution = "1920x1080"
		}
		masterContent += fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%s,RESOLUTION=%s\n", bandwidth, resolution)
		masterContent += r.name + ".m3u8\n"
	}

	if err := os.WriteFile(playlistPath, []byte(masterContent), 0644); err != nil {
		os.RemoveAll(outputDir)
		return fmt.Errorf("write master: %w", err)
	}

	e.db.Exec(`UPDATE media_items SET hls_480p_path = ? WHERE id = ?`, playlistPath, mediaID)
	log.Printf("Encoder: complete media=%d → %s (480p + 1080p ABR)", mediaID, playlistPath)

	go e.generateThumbnails(mediaID, inputPath, outputDir)

	return nil
}

func (e *Encoder) generateThumbnails(mediaID int64, inputPath, outputDir string) {
	spritePath := filepath.Join(outputDir, "sprite.jpg")
	vttPath := filepath.Join(outputDir, "thumbs.vtt")

	durArgs := []string{
		"-v", "quiet",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		inputPath,
	}
	durBytes, err := exec.Command("ffprobe", durArgs...).Output()
	if err != nil {
		log.Printf("Encoder: thumb ffprobe failed media=%d: %v", mediaID, err)
		return
	}
	duration, err := strconv.ParseFloat(strings.TrimSpace(string(durBytes)), 64)
	if err != nil || duration <= 0 {
		return
	}

	spriteArgs := []string{
		"-n", "19", "ffmpeg",
		"-i", inputPath,
		"-vf", "fps=1/10,scale=160x90,tile=5x5",
		"-q:v", "3", "-vsync", "0", "-threads", "1",
		"-y", spritePath,
	}
	cmd := exec.Command("nice", spriteArgs...)
	if err := cmd.Run(); err != nil {
		log.Printf("Encoder: thumb sprite failed media=%d: %v", mediaID, err)
		return
	}

	numFrames := int(duration) / 10
	var vttBuf bytes.Buffer
	vttBuf.WriteString("WEBVTT\n\n")
	for i := 0; i < numFrames; i++ {
		start := i * 10
		end := start + 10
		col := i % 5
		row := i / 5
		startTime := fmt.Sprintf("%02d:%02d:%02d.000", start/3600, (start%3600)/60, start%60)
		endTime := fmt.Sprintf("%02d:%02d:%02d.000", end/3600, (end%3600)/60, end%60)
		vttBuf.WriteString(fmt.Sprintf("%s --> %s\n", startTime, endTime))
		vttBuf.WriteString(fmt.Sprintf("sprite.jpg#xywh=%d,%d,160,90\n\n", col*160, row*90))
	}
	if err := os.WriteFile(vttPath, vttBuf.Bytes(), 0644); err != nil {
		log.Printf("Encoder: thumb VTT write failed media=%d: %v", mediaID, err)
		return
	}
	log.Printf("Encoder: thumbnails done media=%d (%d frames)", mediaID, numFrames)
}
