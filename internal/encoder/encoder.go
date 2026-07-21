package encoder

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"nextflix/internal/config"
	"nextflix/internal/scanner"
)

type Encoder struct {
	db    *sql.DB
	cfg   config.EncoderConfig
	jobCh chan scanner.EncoderJob
}

func New(db *sql.DB, cfg config.EncoderConfig, jobCh chan scanner.EncoderJob) *Encoder {
	return &Encoder{db: db, cfg: cfg, jobCh: jobCh}
}

func (e *Encoder) Start() {
	go e.worker()
	log.Println("Encoder: worker started")
}

func (e *Encoder) worker() {
	for job := range e.jobCh {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Hour)
		func() {
			defer cancel()
			if err := e.encode(ctx, job); err != nil {
				log.Printf("Encoder: failed media=%d: %v", job.MediaID, err)
			}
		}()
	}
}

type rendition struct {
	name    string
	res     string
	bitrate string
	maxrate string
	bufsize string
}

var renditions = []rendition{
	{name: "480p", res: "scale=-2:480", bitrate: "800k", maxrate: "1000k", bufsize: "1600k"},
	{name: "1080p", res: "scale=-2:1080", bitrate: "4000k", maxrate: "5000k", bufsize: "8000k"},
}

var timeRegex = regexp.MustCompile(`time=(\d+):(\d+):(\d+\.\d+)`)

func parseTimeToSeconds(line string) (float64, bool) {
	m := timeRegex.FindStringSubmatch(line)
	if m == nil {
		return 0, false
	}
	h, _ := strconv.Atoi(m[1])
	min, _ := strconv.Atoi(m[2])
	sec, _ := strconv.ParseFloat(m[3], 64)
	return float64(h)*3600 + float64(min)*60 + sec, true
}

func (e *Encoder) ensureJobRows(mediaID int64) {
	var count int
	e.db.QueryRow(`SELECT COUNT(*) FROM encode_jobs WHERE media_id = ?`, mediaID).Scan(&count)
	if count > 0 {
		return
	}
	for _, r := range renditions {
		e.db.Exec(
			`INSERT OR IGNORE INTO encode_jobs (media_id, rendition, status) VALUES (?, ?, 'queued')`,
			mediaID, r.name,
		)
	}
}

func (e *Encoder) updateJob(mediaID int64, renditionName, status string, progress int, errMsg string) {
	switch {
	case status == "in_progress":
		e.db.Exec(`UPDATE encode_jobs SET status = ?, progress_percent = ?, started_at = CURRENT_TIMESTAMP, error = '' WHERE media_id = ? AND rendition = ?`, status, progress, mediaID, renditionName)
	case status == "completed":
		e.db.Exec(`UPDATE encode_jobs SET status = ?, progress_percent = 100, finished_at = CURRENT_TIMESTAMP WHERE media_id = ? AND rendition = ?`, status, mediaID, renditionName)
	case status == "failed":
		e.db.Exec(`UPDATE encode_jobs SET status = ?, error = ?, finished_at = CURRENT_TIMESTAMP WHERE media_id = ? AND rendition = ?`, status, errMsg, mediaID, renditionName)
	default:
		e.db.Exec(`UPDATE encode_jobs SET progress_percent = ? WHERE media_id = ? AND rendition = ?`, progress, mediaID, renditionName)
	}
}

func (e *Encoder) encode(ctx context.Context, job scanner.EncoderJob) error {
	outputDir := filepath.Join(e.cfg.HLSOutputDir, fmt.Sprintf("%d", job.MediaID))

	info, err := os.Stat(outputDir)
	if err == nil && info.IsDir() {
		log.Printf("Encoder: HLS already exists for media=%d, skipping", job.MediaID)
		return nil
	}

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}

	e.ensureJobRows(job.MediaID)

	totalDuration := job.DurationSeconds
	if totalDuration <= 0 {
		var d int
		e.db.QueryRow(`SELECT duration_seconds FROM media_items WHERE id = ?`, job.MediaID).Scan(&d)
		totalDuration = int64(d)
	}

	var wg sync.WaitGroup
	errCh := make(chan error, len(renditions))

	for _, r := range renditions {
		wg.Add(1)
		r := r
		go func() {
			defer wg.Done()
			if err := e.encodeRendition(ctx, job.MediaID, job.FilePath, outputDir, r, totalDuration); err != nil {
				errCh <- fmt.Errorf("%s: %w", r.name, err)
			}
		}()
	}

	wg.Wait()
	close(errCh)

	var firstErr error
	for err := range errCh {
		log.Printf("Encoder: rendition error: %v", err)
		if firstErr == nil {
			firstErr = err
		}
	}
	if firstErr != nil {
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
		return fmt.Errorf("write master: %w", err)
	}

	totalSize := e.dirSize(outputDir)
	e.db.Exec(`UPDATE media_items SET hls_480p_path = ? WHERE id = ?`, playlistPath, job.MediaID)
	e.db.Exec(`UPDATE encode_jobs SET output_path = ?, output_size = ? WHERE media_id = ?`, playlistPath, totalSize, job.MediaID)

	log.Printf("Encoder: complete media=%d → %s (480p + 1080p ABR)", job.MediaID, playlistPath)

	go e.generateThumbnails(job.MediaID, job.FilePath, outputDir)

	return nil
}

func (e *Encoder) encodeRendition(ctx context.Context, mediaID int64, inputPath, outputDir string, r rendition, totalDuration int64) error {
	segPattern := filepath.Join(outputDir, r.name+"_%05d.ts")
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

	cmd := exec.CommandContext(ctx, "nice", args...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		e.updateJob(mediaID, r.name, "failed", 0, fmt.Sprintf("stderr pipe: %v", err))
		return err
	}

	e.updateJob(mediaID, r.name, "in_progress", 0, "")
	log.Printf("Encoder: encoding media=%d → %s (%s)", mediaID, r.name, r.bitrate)

	if err := cmd.Start(); err != nil {
		e.updateJob(mediaID, r.name, "failed", 0, fmt.Sprintf("start: %v", err))
		return err
	}

	lastPct := -1
	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			if totalDuration <= 0 {
				continue
			}
			if secs, ok := parseTimeToSeconds(line); ok {
				pct := int(secs / float64(totalDuration) * 100)
				if pct < 0 {
					pct = 0
				}
				if pct > 99 {
					pct = 99
				}
				if pct != lastPct {
					lastPct = pct
					e.updateJob(mediaID, r.name, "", pct, "")
				}
			}
		}
	}()

	if err := cmd.Wait(); err != nil {
		e.updateJob(mediaID, r.name, "failed", lastPct, err.Error())
		return err
	}

	e.updateJob(mediaID, r.name, "completed", 100, "")
	return nil
}

func (e *Encoder) dirSize(path string) int64 {
	var total int64
	entries, err := os.ReadDir(path)
	if err != nil {
		return 0
	}
	for _, entry := range entries {
		if entry.IsDir() {
			total += e.dirSize(filepath.Join(path, entry.Name()))
			continue
		}
		info, err := entry.Info()
		if err == nil {
			total += info.Size()
		}
	}
	return total
}

func (e *Encoder) Enqueue(job scanner.EncoderJob) error {
	e.ensureJobRows(job.MediaID)
	e.db.Exec(`UPDATE encode_jobs SET status = 'queued', progress_percent = 0, error = '', started_at = NULL, finished_at = NULL WHERE media_id = ?`, job.MediaID)

	select {
	case e.jobCh <- job:
		return nil
	default:
		return fmt.Errorf("encoder queue full")
	}
}

func (e *Encoder) Reenqueue(mediaID int64, filePath string, durationSeconds int64) error {
	outputDir := filepath.Join(e.cfg.HLSOutputDir, fmt.Sprintf("%d", mediaID))
	if err := os.RemoveAll(outputDir); err != nil {
		log.Printf("Encoder: failed to clear HLS dir for media=%d: %v", mediaID, err)
	}
	e.db.Exec(`UPDATE media_items SET hls_480p_path = '' WHERE id = ?`, mediaID)
	e.db.Exec(`UPDATE encode_jobs SET status = 'failed', error = 'superseded' WHERE media_id = ? AND status IN ('queued','in_progress')`, mediaID)

	return e.Enqueue(scanner.EncoderJob{
		MediaID:         mediaID,
		FilePath:        filePath,
		DurationSeconds: durationSeconds,
	})
}

type QueueItem struct {
	MediaID          int64  `json:"media_id"`
	Rendition        string `json:"rendition"`
	Status           string `json:"status"`
	ProgressPercent  int    `json:"progress_percent"`
	StartedAt        string `json:"started_at"`
	FinishedAt      string `json:"finished_at"`
	Error            string `json:"error"`
	OutputPath       string `json:"output_path"`
	OutputSize       int64  `json:"output_size"`
	Title            string `json:"title"`
}

func (e *Encoder) Queue() []QueueItem {
	rows, err := e.db.Query(`
		SELECT j.media_id, j.rendition, j.status, j.progress_percent,
		       COALESCE(j.started_at, ''), COALESCE(j.finished_at, ''),
		       COALESCE(j.error, ''), COALESCE(j.output_path, ''), j.output_size,
		       COALESCE(m.title, '')
		FROM encode_jobs j
		LEFT JOIN media_items m ON m.id = j.media_id
		WHERE j.status IN ('queued','in_progress')
		ORDER BY j.created_at ASC
	`)
	if err != nil {
		return []QueueItem{}
	}
	defer rows.Close()
	var items []QueueItem
	for rows.Next() {
		var q QueueItem
		if err := rows.Scan(&q.MediaID, &q.Rendition, &q.Status, &q.ProgressPercent,
			&q.StartedAt, &q.FinishedAt, &q.Error, &q.OutputPath, &q.OutputSize, &q.Title); err != nil {
			continue
		}
		items = append(items, q)
	}
	if items == nil {
		return []QueueItem{}
	}
	return items
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
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	durBytes, err := exec.CommandContext(ctx, "ffprobe", durArgs...).Output()
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
	ctx2, cancel2 := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel2()
	cmd := exec.CommandContext(ctx2, "nice", spriteArgs...)
	if err := cmd.Run(); err != nil {
		log.Printf("Encoder: thumb sprite failed media=%d: %v", mediaID, err)
		return
	}

	numFrames := int(duration) / 10
	if numFrames == 0 {
		return
	}
	if numFrames > 25 {
		numFrames = 25
	}
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