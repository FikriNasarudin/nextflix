package scanner

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"nextflix/internal/config"

	"github.com/fsnotify/fsnotify"
)

type ProbeResult struct {
	Streams []struct {
		CodecType string `json:"codec_type"`
		CodecName string `json:"codec_name"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
	} `json:"streams"`
	Format struct {
		Duration string `json:"duration"`
		Size     string `json:"size"`
	} `json:"format"`
}

type EncoderJob struct {
	MediaID  int64
	FilePath string
}

type Scanner struct {
	db        *sql.DB
	cfg       config.ScannerConfig
	probeSem  chan struct{}
	encoderCh chan<- EncoderJob
}

var videoExts = map[string]bool{
	".mp4":  true,
	".mkv":  true,
	".avi":  true,
	".mov":  true,
	".webm": true,
	".ts":   true,
	".m4v":  true,
}

func New(db *sql.DB, cfg config.ScannerConfig, encoderCh chan<- EncoderJob) *Scanner {
	return &Scanner{
		db:        db,
		cfg:       cfg,
		probeSem:  make(chan struct{}, cfg.MaxConcurrentFFprobes),
		encoderCh: encoderCh,
	}
}

func (s *Scanner) ScanAll() {
	log.Println("Scanner: starting full scan of", s.cfg.MediaDir)

	err := filepath.Walk(s.cfg.MediaDir, func(path string, fi os.FileInfo, err error) error {
		if err != nil {
			log.Printf("Scanner: error accessing %s: %v", path, err)
			return nil
		}
		if fi.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if !videoExts[ext] {
			return nil
		}
		s.processFile(path)
		return nil
	})
	if err != nil {
		log.Printf("Scanner: walk error: %v", err)
	}

	log.Println("Scanner: full scan complete")
}

func (s *Scanner) Watch() {
	if !s.cfg.EnableFilesystemWatcher {
		return
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("Scanner: watcher error: %v", err)
		return
	}

	if err := watcher.Add(s.cfg.MediaDir); err != nil {
		log.Printf("Scanner: watch add error: %v", err)
		return
	}

	debounce := make(map[string]time.Time)

	go func() {
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if event.Op&(fsnotify.Create|fsnotify.Write) == 0 {
					continue
				}

				ext := strings.ToLower(filepath.Ext(event.Name))
				if !videoExts[ext] {
					continue
				}

				if last, ok := debounce[event.Name]; ok && time.Since(last) < 3*time.Second {
					continue
				}
				debounce[event.Name] = time.Now()

				time.AfterFunc(3*time.Second, func() {
					s.processFile(event.Name)
				})

			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("Scanner: watcher error: %v", err)
			}
		}
	}()
}

func (s *Scanner) processFile(path string) {
	s.probeSem <- struct{}{}
	defer func() { <-s.probeSem }()

	var count int
	s.db.QueryRow(`SELECT COUNT(*) FROM media_items WHERE file_path = ?`, path).Scan(&count)
	if count > 0 {
		return
	}

	result, err := probeFile(path)
	if err != nil {
		log.Printf("Scanner: probe failed %s: %v", path, err)
		return
	}

	duration := 0
	if d, err := fmt.Sscanf(result.Format.Duration, "%f", &duration); err != nil || d == 0 {
		log.Printf("Scanner: parse duration %s: %v", result.Format.Duration, err)
	}

	title := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))

	res, err := s.db.Exec(
		`INSERT INTO media_items (title, file_path, duration_seconds, media_type) VALUES (?, ?, ?, ?)`,
		title, path, duration, "movie",
	)
	if err != nil {
		log.Printf("Scanner: insert error %s: %v", path, err)
		return
	}

	id, _ := res.LastInsertId()
	log.Printf("Scanner: added %s (id=%d, duration=%ds)", title, id, duration)

	isHD := false
	for _, stream := range result.Streams {
		if stream.CodecType == "video" && stream.Height >= 720 {
			isHD = true
			break
		}
	}

	if isHD {
		s.encoderCh <- EncoderJob{MediaID: id, FilePath: path}
	}
}

func probeFile(path string) (*ProbeResult, error) {
	cmd := exec.Command("ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		path,
	)

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe: %w", err)
	}

	var result ProbeResult
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, fmt.Errorf("parse ffprobe output: %w", err)
	}

	return &result, nil
}
