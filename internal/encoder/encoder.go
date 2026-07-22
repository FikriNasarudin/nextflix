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
	"sync/atomic"
	"time"

	"nextflix/internal/config"
	"nextflix/internal/scanner"
)

const EncoderVersion = "3"

type Encoder struct {
	db     *sql.DB
	cfg    config.EncoderConfig
	jobCh  chan scanner.EncoderJob
	ctx    context.Context
	cancel context.CancelFunc
	running int32

	activeJobs map[string]context.CancelFunc
	jobMu      sync.Mutex
}

func New(db *sql.DB, cfg config.EncoderConfig, jobCh chan scanner.EncoderJob) *Encoder {
	return &Encoder{db: db, cfg: cfg, jobCh: jobCh, activeJobs: make(map[string]context.CancelFunc)}
}

func (e *Encoder) Cfg() config.EncoderConfig {
	return e.cfg
}

func (e *Encoder) Start(ctx context.Context) {
	e.ctx, e.cancel = context.WithCancel(ctx)
	atomic.StoreInt32(&e.running, 1)
	go e.worker()
	log.Println("Encoder: worker started")
}

func (e *Encoder) Stop() {
	if atomic.CompareAndSwapInt32(&e.running, 1, 0) {
		e.cancel()
	}
}

func (e *Encoder) Recover() {
	res, _ := e.db.Exec(
		`UPDATE encode_jobs SET status = 'failed', error = 'interrupted by shutdown', finished_at = CURRENT_TIMESTAMP, progress_percent = 0 WHERE status IN ('queued', 'in_progress')`,
	)
	n, _ := res.RowsAffected()
	if n > 0 {
		log.Printf("Encoder: recovered %d stale encode jobs (set to failed)", n)
	}

	var storedVer string
	e.db.QueryRow(`SELECT value FROM settings WHERE key = 'encoder_version'`).Scan(&storedVer)
	if storedVer != EncoderVersion {
		log.Printf("Encoder: version mismatch (stored=%q current=%q), invalidating HLS items", storedVer, EncoderVersion)

		e.db.Exec(`INSERT INTO settings (key, value) VALUES ('encoder_version', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, EncoderVersion, EncoderVersion)
		e.db.Exec(`UPDATE settings SET value = datetime('now') WHERE key = 'last_invalidated_at'`)
		e.db.Exec(`UPDATE settings SET value = ? WHERE key = 'encoder_version'`, EncoderVersion)

		res2, err := e.db.Exec(
			`UPDATE media_items SET hls_stale = 1 WHERE hls_480p_path != '' AND hls_480p_path IS NOT NULL`,
		)
		if err == nil {
			if cnt, _ := res2.RowsAffected(); cnt > 0 {
				log.Printf("Encoder: marked %d media items as stale (version upgrade)", cnt)
			}
		}

		staleIDs := e.staleMediaIDs()
		if len(staleIDs) > 0 {
			go func() {
				for _, mid := range staleIDs {
					var fp string
					var dur int64
					e.db.QueryRow(`SELECT file_path, COALESCE(duration_seconds, 0) FROM media_items WHERE id = ?`, mid).Scan(&fp, &dur)
					if fp == "" {
						continue
					}
					e.ensureJobRows(mid)
					e.db.Exec(`UPDATE encode_jobs SET status = 'queued', progress_percent = 0, error = '', started_at = NULL, finished_at = NULL WHERE media_id = ?`, mid)
					e.jobCh <- scanner.EncoderJob{MediaID: mid, FilePath: fp, DurationSeconds: dur}
				}
			}()
		}
	}
}

func (e *Encoder) staleMediaIDs() []int64 {
	rows, err := e.db.Query(`SELECT id FROM media_items WHERE hls_stale = 1 AND hls_480p_path != '' AND hls_480p_path IS NOT NULL`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}
	return ids
}

func (e *Encoder) worker() {
	for {
		select {
		case job, ok := <-e.jobCh:
			if !ok {
				return
			}
			select {
			case <-e.ctx.Done():
				return
			default:
			}
			func() {
				ctx, cancel := context.WithTimeout(e.ctx, 4*time.Hour)
				defer cancel()
				if err := e.encode(ctx, job); err != nil {
					log.Printf("Encoder: failed media=%d: %v", job.MediaID, err)
				}
			}()
		case <-e.ctx.Done():
			return
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

var renditions = []rendition{
	{name: "480p", res: "scale=-2:480", bitrate: "800k", maxrate: "1000k", bufsize: "1600k"},
	{name: "1080p", res: "scale=-2:1080", bitrate: "6000k", maxrate: "8000k", bufsize: "12000k"},
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

func (e *Encoder) isAlreadyEncoded(mediaID int64) bool {
	var hlsPath string
	e.db.QueryRow(`SELECT COALESCE(hls_480p_path, '') FROM media_items WHERE id = ?`, mediaID).Scan(&hlsPath)
	if hlsPath == "" {
		return false
	}
	var completed int
	e.db.QueryRow(`SELECT COUNT(*) FROM encode_jobs WHERE media_id = ? AND status = 'completed' AND rendition IN ('480p', '1080p')`, mediaID).Scan(&completed)
	return completed == 2
}

func globSize(pattern string) int64 {
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return 0
	}
	var total int64
	for _, m := range matches {
		info, err := os.Stat(m)
		if err == nil {
			total += info.Size()
		}
	}
	return total
}

func (e *Encoder) encode(ctx context.Context, job scanner.EncoderJob) error {
	outputDir := filepath.Join(e.cfg.HLSOutputDir, fmt.Sprintf("%d", job.MediaID))

	if e.isAlreadyEncoded(job.MediaID) {
		info, err := os.Stat(outputDir)
		if err == nil && info.IsDir() {
			log.Printf("Encoder: HLS already exists for media=%d, skipping", job.MediaID)
			return nil
		}
	}

	if err := os.RemoveAll(outputDir); err != nil {
		log.Printf("Encoder: failed to clean HLS dir for media=%d: %v", job.MediaID, err)
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}

	e.ensureJobRows(job.MediaID)

	srcStat, err := os.Stat(job.FilePath)
	srcSize := int64(0)
	srcMtime := int64(0)
	if err == nil {
		srcSize = srcStat.Size()
		srcMtime = srcStat.ModTime().Unix()
	}
	e.db.Exec(`UPDATE media_items SET source_size = ?, source_mtime = ? WHERE id = ?`, srcSize, srcMtime, job.MediaID)

	totalDuration := job.DurationSeconds
	if totalDuration <= 0 {
		var d int
		e.db.QueryRow(`SELECT duration_seconds FROM media_items WHERE id = ?`, job.MediaID).Scan(&d)
		totalDuration = int64(d)
	}

	var codec string
	e.db.QueryRow(`SELECT codec FROM media_video_tracks WHERE media_id = ? AND is_default = 1`, job.MediaID).Scan(&codec)
	skip1080p := codec == "h264"

	var activeRenditions []rendition
	for _, r := range renditions {
		if r.name == "1080p" && skip1080p {
			e.db.Exec(`UPDATE encode_jobs SET status = 'completed', progress_percent = 100, finished_at = CURRENT_TIMESTAMP WHERE media_id = ? AND rendition = ?`, job.MediaID, r.name)
			continue
		}
		activeRenditions = append(activeRenditions, r)
	}

	var wg sync.WaitGroup
	errCh := make(chan error, len(activeRenditions))

	for _, r := range activeRenditions {
		wg.Add(1)
		r := r
		go func() {
			defer wg.Done()
			if err := e.encodeRendition(ctx, job.MediaID, job.FilePath, outputDir, r, totalDuration); err != nil {
				select {
				case errCh <- fmt.Errorf("%s: %w", r.name, err):
				default:
				}
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

	if ctx.Err() != nil {
		e.db.Exec(`UPDATE encode_jobs SET status = 'failed', error = 'interrupted by shutdown', finished_at = CURRENT_TIMESTAMP WHERE media_id = ? AND status = 'in_progress'`, job.MediaID)
		return ctx.Err()
	}

	playlistPath := filepath.Join(outputDir, "index.m3u8")
	var masterContent string
	masterContent += "#EXTM3U\n"
	for _, r := range activeRenditions {
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

	for _, r := range activeRenditions {
		size := globSize(filepath.Join(outputDir, r.name+"_*.ts"))
		e.db.Exec(`UPDATE encode_jobs SET output_path = ?, output_size = ?, source_size = ?, source_mtime = ? WHERE media_id = ? AND rendition = ?`,
			playlistPath, size, srcSize, srcMtime, job.MediaID, r.name)
	}

	e.db.Exec(`UPDATE media_items SET hls_480p_path = ?, hls_stale = 0 WHERE id = ?`, playlistPath, job.MediaID)

	log.Printf("Encoder: complete media=%d → %s", job.MediaID, playlistPath)

	go e.generateThumbnails(job.MediaID, job.FilePath, outputDir)

	return nil
}

func (e *Encoder) encodeRendition(ctx context.Context, mediaID int64, inputPath, outputDir string, r rendition, totalDuration int64) error {
	segPattern := filepath.Join(outputDir, r.name+"_%05d.ts")
	playlist := filepath.Join(outputDir, r.name+".m3u8")

	jobKey := fmt.Sprintf("%d:%s", mediaID, r.name)

	encCtx, encCancel := context.WithCancel(ctx)
	e.jobMu.Lock()
	e.activeJobs[jobKey] = encCancel
	e.jobMu.Unlock()

	defer func() {
		e.jobMu.Lock()
		delete(e.activeJobs, jobKey)
		e.jobMu.Unlock()
		encCancel()
	}()

	args := []string{
		"-n", "19",
		"ffmpeg",
		"-i", inputPath,
		"-map", "0:v:0",
		"-map", "0:a:0?",
		"-vf", r.res,
		"-c:v", "libx264",
		"-profile:v", "main",
		"-level", "4.0",
		"-pix_fmt", "yuv420p",
		"-b:v", r.bitrate,
		"-maxrate", r.maxrate,
		"-bufsize", r.bufsize,
		"-preset", e.cfg.FFmpegPreset,
		"-threads", "1",
		"-max_muxing_queue_size", "1024",
		"-c:a", "aac",
		"-b:a", "128k",
		"-ar", "48000",
		"-ac", "2",
		"-af", "aresample=async=1",
		"-f", "hls",
		"-hls_time", fmt.Sprintf("%d", e.cfg.HLSSegmentDurationSec),
		"-hls_list_size", "0",
		"-hls_playlist_type", "vod",
		"-hls_segment_type", "mpegts",
		"-hls_flags", "independent_segments",
		"-hls_segment_filename", segPattern,
		playlist,
	}

	cmd := exec.CommandContext(encCtx, "nice", args...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		e.updateJob(mediaID, r.name, "failed", 0, fmt.Sprintf("stderr pipe: %v", err))
		return err
	}

	e.updateJob(mediaID, r.name, "in_progress", 0, "")
	log.Printf("Encoder: encoding media=%d → %s (%s)", mediaID, r.name, r.bitrate)

	if err := cmd.Start(); err != nil {
		if encCtx.Err() != nil {
			e.updateJob(mediaID, r.name, "failed", 0, "interrupted by shutdown")
			return encCtx.Err()
		}
		e.updateJob(mediaID, r.name, "failed", 0, fmt.Sprintf("start: %v", err))
		return err
	}

	lastPct := -1
	go func() {
		s := bufio.NewScanner(stderr)
		s.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for s.Scan() {
			line := s.Text()
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
		if encCtx.Err() != nil {
			e.updateJob(mediaID, r.name, "failed", lastPct, "interrupted by shutdown")
			return encCtx.Err()
		}
		e.updateJob(mediaID, r.name, "failed", lastPct, err.Error())
		return err
	}

	e.updateJob(mediaID, r.name, "completed", 100, "")
	return nil
}

func (e *Encoder) Enqueue(job scanner.EncoderJob) error {
	e.ensureJobRows(job.MediaID)
	e.db.Exec(`UPDATE encode_jobs SET status = 'queued', progress_percent = 0, error = '', started_at = NULL, finished_at = NULL WHERE media_id = ?`, job.MediaID)
	e.db.Exec(`UPDATE media_items SET hls_stale = 0 WHERE id = ?`, job.MediaID)

	select {
	case e.jobCh <- job:
		return nil
	default:
		return fmt.Errorf("encoder queue full")
	}
}

func (e *Encoder) Reenqueue(mediaID int64, filePath string, durationSeconds int64) error {
	outputDir := filepath.Join(e.cfg.HLSOutputDir, fmt.Sprintf("%d", mediaID))
	os.RemoveAll(outputDir)
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
	FinishedAt       string `json:"finished_at"`
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

func (e *Encoder) ReencodeAllStale() (int, error) {
	ids := e.staleMediaIDs()
	if len(ids) == 0 {
		return 0, nil
	}
	go func() {
		for _, mid := range ids {
			var fp string
			var dur int64
			e.db.QueryRow(`SELECT file_path, COALESCE(duration_seconds, 0) FROM media_items WHERE id = ?`, mid).Scan(&fp, &dur)
			if fp == "" {
				continue
			}
			e.ensureJobRows(mid)
			e.db.Exec(`UPDATE encode_jobs SET status = 'queued', progress_percent = 0, error = '', started_at = NULL, finished_at = NULL WHERE media_id = ?`, mid)
			e.jobCh <- scanner.EncoderJob{MediaID: mid, FilePath: fp, DurationSeconds: dur}
		}
	}()
	return len(ids), nil
}

func (e *Encoder) CancelJob(mediaID int64, rendition string) error {
	jobKey := fmt.Sprintf("%d:%s", mediaID, rendition)
	e.jobMu.Lock()
	cancel, ok := e.activeJobs[jobKey]
	e.jobMu.Unlock()
	if ok {
		cancel()
	}
	e.db.Exec(`UPDATE encode_jobs SET status = 'failed', error = 'cancelled by admin', finished_at = CURRENT_TIMESTAMP, progress_percent = 0 WHERE media_id = ? AND rendition = ? AND status IN ('queued','in_progress')`, mediaID, rendition)
	return nil
}

func (e *Encoder) ClearQueue() (int, error) {
	res, err := e.db.Exec(`UPDATE encode_jobs SET status = 'failed', error = 'queue cleared by admin', finished_at = CURRENT_TIMESTAMP, progress_percent = 0 WHERE status = 'queued'`)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
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