package scanner

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"nextflix/internal/config"
	"nextflix/internal/resolver"

	"github.com/fsnotify/fsnotify"
)

var imageExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".tbn": true, ".gif": true, ".svg": true,
}

var posterBaseNames = []string{"poster", "folder", "cover", "default", "movie", "show"}
var backdropBaseNames = []string{"backdrop", "fanart", "background", "art"}

type ProbeStream struct {
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Index     int    `json:"index"`
	Channels  int    `json:"channels"`
	Tags      struct {
		Language string `json:"language"`
		Title    string `json:"title"`
	} `json:"tags"`
}

type ProbeResult struct {
	Streams []ProbeStream `json:"streams"`
	Format  struct {
		Duration string `json:"duration"`
		Size     string `json:"size"`
	} `json:"format"`
}

type EncoderJob struct {
	MediaID  int64
	FilePath string
}

type ScanProgress struct {
	mu       sync.Mutex
	Running  bool   `json:"running"`
	Current  int    `json:"current"`
	Total    int    `json:"total"`
	Library  string `json:"library"`
	LastItem string `json:"last_item"`
}

func (p *ScanProgress) Snapshot() ScanProgress {
	p.mu.Lock()
	defer p.mu.Unlock()
	return ScanProgress{
		Running:  p.Running,
		Current:  p.Current,
		Total:    p.Total,
		Library:  p.Library,
		LastItem: p.LastItem,
	}
}

func (p *ScanProgress) setRunning(v bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Running = v
}

func (p *ScanProgress) setCurrent(n int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Current = n
}

func (p *ScanProgress) setTotal(n int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Total = n
}

func (p *ScanProgress) setLibrary(lib string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Library = lib
}

func (p *ScanProgress) setLastItem(item string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.LastItem = item
}

type ProcessFunc func(path string) *resolver.ResolveResult

type Scanner struct {
	db        *sql.DB
	cfg       config.ScannerConfig
	opts      *resolver.NamingOptions
	probeSem  chan struct{}
	encoderCh chan<- EncoderJob
	progress  *ScanProgress
	imageDir  string
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

func New(db *sql.DB, cfg config.ScannerConfig, opts *resolver.NamingOptions, encoderCh chan<- EncoderJob, imageDir string) *Scanner {
	if imageDir == "" {
		imageDir = "./data/images"
	}
	return &Scanner{
		db:        db,
		cfg:       cfg,
		opts:      opts,
		probeSem:  make(chan struct{}, cfg.MaxConcurrentFFprobes),
		encoderCh: encoderCh,
		progress:  &ScanProgress{},
		imageDir:  imageDir,
	}
}

func (s *Scanner) Progress() ScanProgress {
	return s.progress.Snapshot()
}

func (s *Scanner) IsRunning() bool {
	s.progress.mu.Lock()
	defer s.progress.mu.Unlock()
	return s.progress.Running
}

func (s *Scanner) ScanAll(resolve ProcessFunc) {
	s.progress.setRunning(true)
	s.progress.setCurrent(0)
	s.progress.setTotal(0)
	s.progress.setLibrary("")
	s.progress.setLastItem("")

	libraries := s.loadLibraries()
	if len(libraries) == 0 {
		log.Println("Scanner: no library directories found under", s.cfg.MediaDir)
		s.progress.setRunning(false)
		return
	}

	var files []string
	for dir, lib := range libraries {
		fullPath := filepath.Join(s.cfg.MediaDir, dir)
		s.progress.setLibrary(lib.name)
		log.Printf("Scanner: scanning library %q (%s)", lib.name, fullPath)

		filepath.WalkDir(fullPath, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				log.Printf("Scanner: error accessing %s: %v", path, err)
				return nil
			}
			if d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if !s.isVideoExt(ext) {
				return nil
			}
			files = append(files, path)
			return nil
		})
	}

	s.progress.setTotal(len(files))

	for i, path := range files {
		result := resolve(path)
		if result == nil {
			continue
		}

		libID, _ := s.resolveLibrary(path)
		mediaType := result.MediaType
		if mediaType == "" {
			_, mediaType = s.resolveLibrary(path)
		}

		s.processFile(path, libID, mediaType, result)
		s.progress.setLastItem(filepath.Base(path))
		s.progress.setCurrent(i + 1)
	}

	log.Println("Scanner: full scan complete")
	s.progress.setRunning(false)
	s.progress.setLastItem("Scan complete")
}

type libraryInfo struct {
	id        int64
	name      string
	mediaType string
}

func (s *Scanner) isVideoExt(ext string) bool {
	if videoExts[ext] {
		return true
	}
	if s.opts != nil {
		for _, ve := range s.opts.VideoFileExtensions {
			if strings.EqualFold(ext, "."+strings.TrimPrefix(ve, ".")) ||
				strings.EqualFold(ext, ve) {
				return true
			}
		}
	}
	return false
}

func titleCase(s string) string {
	if len(s) == 0 {
		return s
	}
	words := strings.Fields(s)
	for i, w := range words {
		runes := []rune(w)
		if len(runes) > 0 {
			runes[0] = []rune(strings.ToUpper(string(runes[0])))[0]
			words[i] = string(runes)
		}
	}
	return strings.Join(words, " ")
}

func (s *Scanner) loadLibraries() map[string]libraryInfo {
	result := make(map[string]libraryInfo)

	rows, err := s.db.Query(`
		SELECT l.id, l.name, l.media_type, lf.folder_path
		FROM libraries l
		JOIN library_folders lf ON lf.library_id = l.id
		WHERE lf.folder_path != ''
		ORDER BY l.id, lf.folder_path
	`)
	if err != nil {
		log.Printf("Scanner: cannot query libraries: %v", err)
		return nil
	}
	defer rows.Close()

	for rows.Next() {
		var libID int64
		var name, mediaType, folderPath string
		if err := rows.Scan(&libID, &name, &mediaType, &folderPath); err != nil {
			continue
		}
		if _, exists := result[folderPath]; !exists {
			result[folderPath] = libraryInfo{
				id:        libID,
				name:      name,
				mediaType: mediaType,
			}
		}
	}

	if len(result) == 0 {
		log.Println("Scanner: no libraries configured — use /admin/libraries to create them")
	}

	return result
}

func (s *Scanner) Watch(resolve ProcessFunc) {
	if !s.cfg.EnableFilesystemWatcher {
		return
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("Scanner: watcher error: %v", err)
		return
	}

	debounce := make(map[string]time.Time)

	addDir := func(dir string) {
		if err := watcher.Add(dir); err != nil {
			log.Printf("Scanner: watch add %s: %v", dir, err)
		}
	}

	addDir(s.cfg.MediaDir)
	libraries := s.loadLibraries()
	for dir := range libraries {
		addDir(filepath.Join(s.cfg.MediaDir, dir))
	}

	go func() {
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}

			if event.Op&fsnotify.Create != 0 {
				fi, err := os.Stat(event.Name)
				if err == nil && fi.IsDir() {
					addDir(event.Name)
					log.Printf("Scanner: detected new directory %s — update libraries in admin panel to include it", event.Name)
					continue
				}
			}

				if event.Op&(fsnotify.Create|fsnotify.Write) == 0 {
					continue
				}

				ext := strings.ToLower(filepath.Ext(event.Name))
				if !s.isVideoExt(ext) {
					continue
				}

				if last, ok := debounce[event.Name]; ok && time.Since(last) < 3*time.Second {
					continue
				}
				debounce[event.Name] = time.Now()

				for k, t := range debounce {
					if time.Since(t) > 10*time.Second {
						delete(debounce, k)
					}
				}

				time.AfterFunc(3*time.Second, func() {
					if resolve == nil {
						return
					}
					result := resolve(event.Name)
					if result == nil {
						return
					}
					libID, libMediaType := s.resolveLibrary(event.Name)
					mediaType := result.MediaType
					if mediaType == "" {
						mediaType = libMediaType
					}
					s.processFile(event.Name, libID, mediaType, result)
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

func (s *Scanner) resolveLibrary(path string) (int64, string) {
	rel, err := filepath.Rel(s.cfg.MediaDir, path)
	if err != nil {
		return 0, "movie"
	}
	parts := strings.SplitN(rel, string(os.PathSeparator), 2)
	if len(parts) < 2 {
		return 0, "movie"
	}
	dirName := parts[0]

	var libID int64
	var mediaType string
	s.db.QueryRow(`
		SELECT l.id, l.media_type FROM libraries l
		JOIN library_folders lf ON lf.library_id = l.id
		WHERE lf.folder_path = ?
	`, dirName).Scan(&libID, &mediaType)
	if libID == 0 {
		return 0, "movie"
	}
	return libID, mediaType
}

func (s *Scanner) processFile(path string, libraryID int64, mediaType string, result *resolver.ResolveResult) {
	s.probeSem <- struct{}{}
	defer func() { <-s.probeSem }()

	absPath, err := filepath.Abs(path)
	if err == nil {
		path = absPath
	} else {
		log.Printf("Scanner: failed to resolve abs path %s: %v", path, err)
	}

	var existingID int64
	var existingDur int
	s.db.QueryRow(`SELECT id, duration_seconds FROM media_items WHERE file_path = ?`, path).Scan(&existingID, &existingDur)
	if existingID > 0 && existingDur > 0 {
		return
	}

	probeResult, err := probeFile(path)
	if err != nil {
		log.Printf("Scanner: probe failed %s: %v", path, err)
		return
	}

	var duration int
	if probeResult.Format.Duration != "" && probeResult.Format.Duration != "N/A" {
		if d, err := strconv.ParseFloat(probeResult.Format.Duration, 64); err == nil {
			duration = int(d)
		}
	}
	if duration == 0 {
		duration = probeFallbackDuration(path)
	}

	tmdbID := result.TmdbID
	showName := result.ShowName
	seasonNumber := result.SeasonNumber
	episodeNumber := result.EpisodeNumber
	episodeEnd := result.EpisodeEnd
	episodeTitle := result.EpisodeTitle
	year := result.Year

	title := ""
	if result.Item != nil {
		title = result.Item.Title
	}
	if title == "" {
		title = filepath.Base(path)
	}

	groupID := s.resolveGroupID(path, libraryID)

	if existingID > 0 {
		s.db.Exec(`UPDATE media_items SET duration_seconds = ? WHERE file_path = ?`, duration, path)
		log.Printf("Scanner: updated duration for %s (path=%s, duration=%ds)", title, path, duration)
		return
	}

	type insertArgs struct {
		title         string
		showName      string
		seasonNumber  int
		episodeNumber int
		episodeTitle  string
	}

	var episodes []insertArgs

	if episodeEnd > episodeNumber && seasonNumber > 0 {
		end := episodeEnd
		if end-episodeNumber > 100 {
			end = episodeNumber + 100
		}
		for ep := episodeNumber; ep <= end; ep++ {
			epTitle := fmt.Sprintf("%s S%02dE%02d", showName, seasonNumber, ep)
			episodes = append(episodes, insertArgs{
				title:         epTitle,
				showName:      showName,
				seasonNumber:  seasonNumber,
				episodeNumber: ep,
				episodeTitle:  "",
			})
		}
	} else {
		episodes = append(episodes, insertArgs{
			title:         title,
			showName:      showName,
			seasonNumber:  seasonNumber,
			episodeNumber: episodeNumber,
			episodeTitle:  episodeTitle,
		})
	}

	s.db.Exec(`BEGIN IMMEDIATE`)
	for _, ep := range episodes {
		var insertSQL string
		var insertArgs []any

		if libraryID > 0 {
			insertSQL = `INSERT INTO media_items (library_id, title, file_path, duration_seconds, media_type, show_name, season_number, episode_number, episode_title, year, tmdb_id, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			insertArgs = []any{libraryID, ep.title, path, duration, mediaType, ep.showName, ep.seasonNumber, ep.episodeNumber, ep.episodeTitle, year, tmdbID, groupID}
		} else {
			insertSQL = `INSERT INTO media_items (title, file_path, duration_seconds, media_type, show_name, season_number, episode_number, episode_title, year, tmdb_id, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			insertArgs = []any{ep.title, path, duration, mediaType, ep.showName, ep.seasonNumber, ep.episodeNumber, ep.episodeTitle, year, tmdbID, groupID}
		}

		res, err := s.db.Exec(insertSQL, insertArgs...)
		if err != nil {
			log.Printf("Scanner: skipped %s (duplicate or error): %v", path, err)
			continue
		}

		id, _ := res.LastInsertId()
		log.Printf("Scanner: added %s (id=%d, library=%d, type=%s, duration=%ds)", ep.title, id, libraryID, mediaType, duration)

		if s.encoderCh != nil {
			select {
			case s.encoderCh <- EncoderJob{MediaID: id, FilePath: path}:
			default:
				log.Printf("Scanner: encoder queue full, skipping encode for media %d", id)
			}
		}

		if !s.detectLocalImages(id, path, ep.showName, ep.seasonNumber, mediaType) {
			s.extractEmbeddedCover(id, path)
		}

		s.detectSubtitles(id, path)
		s.storeAudioTracks(id, probeResult.Streams)
	}
	s.db.Exec(`COMMIT`)
}

func (s *Scanner) resolveGroupID(path string, libraryID int64) int64 {
	dir := filepath.Dir(path)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	var videoFiles []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if videoExts[ext] || s.isVideoExt(ext) {
			videoFiles = append(videoFiles, e.Name())
		}
	}
	if len(videoFiles) < 2 {
		return 0
	}
	hash := int64(0)
	for _, c := range dir {
		hash = hash*31 + int64(c)
	}
	return hash
}

func (s *Scanner) detectLocalImages(mediaID int64, filePath, showName string, seasonNumber int, mediaType string) bool {
	dir := filepath.Dir(filePath)
	hasPoster := false

	for _, base := range posterBaseNames {
		p := findImageInDir(dir, base)
		if p != "" {
			s.db.Exec(`INSERT OR IGNORE INTO media_images (media_id, image_type, file_path, is_primary) VALUES (?, 'poster', ?, 1)`, mediaID, p)
			hasPoster = true
			break
		}
	}

	for _, base := range backdropBaseNames {
		p := findImageInDir(dir, base)
		if p != "" {
			s.db.Exec(`INSERT OR IGNORE INTO media_images (media_id, image_type, file_path, is_primary) VALUES (?, 'backdrop', ?, 1)`, mediaID, p)
			s.db.Exec(`UPDATE media_items SET backdrop_path = ? WHERE id = ? AND (backdrop_path = '' OR backdrop_path IS NULL)`, p, mediaID)
			break
		}
	}

	if showName != "" && mediaType == "tv" {
		parentDir := filepath.Dir(dir)
		if seasonNumber > 0 {
			seasonBases := []string{
				fmt.Sprintf("season%02d-poster", seasonNumber),
				fmt.Sprintf("season%d-poster", seasonNumber),
				fmt.Sprintf("Season%02d-poster", seasonNumber),
			}
			for _, base := range seasonBases {
				p := findImageInDir(parentDir, base)
				if p != "" {
					s.db.Exec(`INSERT OR IGNORE INTO show_images (show_name, image_type, season_number, file_path) VALUES (?, 'season_poster', ?, ?)`, showName, seasonNumber, p)
					break
				}
			}
		}

		showPoster := append([]string{}, posterBaseNames...)
		showPoster = append(showPoster, "tvshow")
		for _, base := range showPoster {
			p := findImageInDir(parentDir, base)
			if p != "" {
				s.db.Exec(`INSERT OR IGNORE INTO show_images (show_name, image_type, season_number, file_path) VALUES (?, 'poster', 0, ?)`, showName, p)
				break
			}
		}
		for _, base := range backdropBaseNames {
			p := findImageInDir(parentDir, base)
			if p != "" {
				s.db.Exec(`INSERT OR IGNORE INTO show_images (show_name, image_type, season_number, file_path) VALUES (?, 'backdrop', 0, ?)`, showName, p)
				break
			}
		}
	}

	return hasPoster
}

func findImageInDir(dir, baseName string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	lower := strings.ToLower(baseName)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if !imageExtensions[ext] {
			continue
		}
		name := strings.ToLower(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))
		if name == lower {
			return filepath.Join(dir, entry.Name())
		}
	}
	return ""
}

func (s *Scanner) extractEmbeddedCover(mediaID int64, filePath string) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return
	}

	if err := os.MkdirAll(s.imageDir, 0755); err != nil {
		log.Printf("Scanner: cannot create image cache dir %s: %v", s.imageDir, err)
		return
	}

	outPath := filepath.Join(s.imageDir, fmt.Sprintf("%d-poster.jpg", mediaID))

	cmd := exec.Command("ffmpeg",
		"-y",
		"-loglevel", "error",
		"-ss", "0",
		"-i", filePath,
		"-vframes", "1",
		"-q:v", "2",
		outPath,
	)

	if err := cmd.Run(); err != nil {
		return
	}

	info, err := os.Stat(outPath)
	if err != nil || info.Size() == 0 {
		return
	}

	s.db.Exec(`INSERT OR IGNORE INTO media_images (media_id, image_type, file_path, is_primary) VALUES (?, 'poster', ?, 1)`, mediaID, outPath)
	log.Printf("Scanner: extracted embedded poster for media %d", mediaID)
}

var subtitleExts = map[string]string{
	".srt": "srt",
	".vtt": "vtt",
	".ass": "ass",
	".ssa": "ssa",
	".sub": "sub",
	".idx": "idx",
}

func (s *Scanner) detectSubtitles(mediaID int64, filePath string) {
	dir := filepath.Dir(filePath)
	base := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))

	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		codec, ok := subtitleExts[ext]
		if !ok {
			continue
		}

		name := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		language := "und"
		isForced := 0

		if strings.HasPrefix(strings.ToLower(name), strings.ToLower(base)) {
			rest := name[len(base):]
			if strings.HasPrefix(rest, ".") {
				rest = rest[1:]
			}
			parts := strings.Split(rest, ".")
			for _, p := range parts {
				lower := strings.ToLower(p)
				if lower == "forced" || lower == "force" {
					isForced = 1
				} else if len(lower) == 2 || len(lower) == 3 || (len(lower) == 5 && lower[2] == '-') {
					language = lower
				}
			}
		}

		fullPath := filepath.Join(dir, entry.Name())
		s.db.Exec(
			`INSERT OR IGNORE INTO media_subtitles (media_id, language, codec, file_path, is_forced, is_external) VALUES (?, ?, ?, ?, ?, 1)`,
			mediaID, language, codec, fullPath, isForced,
		)
	}
}

func (s *Scanner) storeAudioTracks(mediaID int64, streams []ProbeStream) {
	for _, stream := range streams {
		if stream.CodecType != "audio" {
			continue
		}
		lang := stream.Tags.Language
		if lang == "" {
			lang = "und"
		}
		title := stream.Tags.Title
		isDefault := 0
		if stream.Index == 0 {
			isDefault = 1
		}
		s.db.Exec(
			`INSERT OR IGNORE INTO media_audio_tracks (media_id, language, codec, channels, stream_index, title, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			mediaID, lang, stream.CodecName, stream.Channels, stream.Index, title, isDefault,
		)
	}
}

func probeFallbackDuration(path string) int {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		"-analyzeduration", "100M",
		"-probesize", "50M",
		path,
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		log.Printf("Scanner: probe fallback duration failed %s: %s: %v", path, strings.TrimSpace(stderr.String()), err)
		return 0
	}
	s := strings.TrimSpace(string(out))
	if s == "" || s == "N/A" {
		return 0
	}
	if d, err := strconv.ParseFloat(s, 64); err == nil && d > 0 {
		return int(d)
	}
	return 0
}

func probeFile(path string) (*ProbeResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		"-analyzeduration", "100M",
		"-probesize", "50M",
		path,
	)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe: %s: %w", strings.TrimSpace(stderr.String()), err)
	}

	var result ProbeResult
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, fmt.Errorf("parse ffprobe output: %w", err)
	}

	return &result, nil
}
