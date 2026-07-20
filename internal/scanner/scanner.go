package scanner

import (
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

	"github.com/fsnotify/fsnotify"
)

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
	Format struct {
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

type Scanner struct {
	db        *sql.DB
	cfg       config.ScannerConfig
	probeSem  chan struct{}
	encoderCh chan<- EncoderJob
	progress  *ScanProgress
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
		progress:  &ScanProgress{},
	}
}

func (s *Scanner) Progress() ScanProgress {
	return s.progress.Snapshot()
}

func (s *Scanner) ScanAll() {
	s.progress.setRunning(true)
	s.progress.setCurrent(0)
	s.progress.setTotal(0)
	s.progress.setLibrary("")
	s.progress.setLastItem("")

	libraries := s.ensureLibraries()
	if len(libraries) == 0 {
		log.Println("Scanner: no library directories found under", s.cfg.MediaDir)
		s.progress.setRunning(false)
		return
	}

	total := 0
	for dir := range libraries {
		fullPath := filepath.Join(s.cfg.MediaDir, dir)
		filepath.Walk(fullPath, func(path string, fi os.FileInfo, err error) error {
			if err != nil || fi.IsDir() {
				return nil
			}
			if videoExts[strings.ToLower(filepath.Ext(path))] {
				total++
			}
			return nil
		})
	}
	s.progress.setTotal(total)

	processed := 0
	for dir, lib := range libraries {
		fullPath := filepath.Join(s.cfg.MediaDir, dir)
		s.progress.setLibrary(lib.name)
		log.Printf("Scanner: scanning library %q (%s)", lib.name, fullPath)

		filepath.Walk(fullPath, func(path string, fi os.FileInfo, err error) error {
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
			s.processFile(path, lib.id, lib.mediaType)
			s.progress.setLastItem(filepath.Base(path))
			processed++
			s.progress.setCurrent(processed)
			return nil
		})
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

func mediaTypeForLibrary(name string) string {
	switch strings.ToLower(name) {
	case "movies", "movie", "films", "film":
		return "movie"
	case "tvshows", "tv", "tv-shows", "television", "series":
		return "tv"
	case "anime":
		return "movie"
	default:
		return "movie"
	}
}

func (s *Scanner) ensureLibraries() map[string]libraryInfo {
	entries, err := os.ReadDir(s.cfg.MediaDir)
	if err != nil {
		log.Printf("Scanner: cannot read media dir %s: %v", s.cfg.MediaDir, err)
		return nil
	}

	existing := make(map[string]int64)
	rows, err := s.db.Query(`SELECT id, library_dir FROM libraries WHERE library_dir != ''`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int64
			var dir string
			rows.Scan(&id, &dir)
			existing[dir] = id
		}
	}

	result := make(map[string]libraryInfo)

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dirName := entry.Name()
		libID, known := existing[dirName]

		if !known {
			libName := titleCase(strings.ReplaceAll(dirName, "-", " "))
			res, err := s.db.Exec(
				`INSERT INTO libraries (name, description, library_dir) VALUES (?, ?, ?)`,
				libName, "", dirName,
			)
			if err != nil {
				log.Printf("Scanner: create library for %s: %v", dirName, err)
				continue
			}
			id, _ := res.LastInsertId()
			libID = id
			log.Printf("Scanner: auto-created library %q (id=%d) for %s", libName, id, dirName)
		}

		result[dirName] = libraryInfo{
			id:        libID,
			name:      dirName,
			mediaType: mediaTypeForLibrary(dirName),
		}
	}

	return result
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

	debounce := make(map[string]time.Time)

	addDir := func(dir string) {
		if err := watcher.Add(dir); err != nil {
			log.Printf("Scanner: watch add %s: %v", dir, err)
		}
	}

	addDir(s.cfg.MediaDir)
	libraries := s.ensureLibraries()
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
						dirName := filepath.Base(event.Name)
						addDir(event.Name)
						libName := titleCase(strings.ReplaceAll(dirName, "-", " "))
						s.db.Exec(
							`INSERT OR IGNORE INTO libraries (name, description, library_dir) VALUES (?, ?, ?)`,
							libName, "", dirName,
						)
						log.Printf("Scanner: watching new library dir %s", event.Name)
						return
					}
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
					libID, mediaType := s.resolveLibrary(event.Name)
					s.processFile(event.Name, libID, mediaType)
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
	if len(parts) < 1 {
		return 0, "movie"
	}
	dirName := parts[0]

	var libID int64
	s.db.QueryRow(`SELECT id FROM libraries WHERE library_dir = ?`, dirName).Scan(&libID)
	if libID == 0 {
		libName := titleCase(strings.ReplaceAll(dirName, "-", " "))
		res, err := s.db.Exec(
			`INSERT INTO libraries (name, description, library_dir) VALUES (?, ?, ?)`,
			libName, "", dirName,
		)
		if err == nil {
			libID, _ = res.LastInsertId()
		}
	}

	return libID, mediaTypeForLibrary(dirName)
}

func (s *Scanner) processFile(path string, libraryID int64, mediaType string) {
	s.probeSem <- struct{}{}
	defer func() { <-s.probeSem }()

	var existingID int64
	var existingDur int
	s.db.QueryRow(`SELECT id, duration_seconds FROM media_items WHERE file_path = ?`, path).Scan(&existingID, &existingDur)
	if existingID > 0 && existingDur > 0 {
		return
	}

	result, err := probeFile(path)
	if err != nil {
		log.Printf("Scanner: probe failed %s: %v", path, err)
		return
	}

	var duration int
	if result.Format.Duration != "" && result.Format.Duration != "N/A" {
		if d, err := strconv.ParseFloat(result.Format.Duration, 64); err == nil {
			duration = int(d)
		}
	}
	if duration == 0 {
		duration = probeFallbackDuration(path)
	}

	parsed := ParseMedia(path, mediaType, s.cfg.MediaDir)

	if mediaType == "movie" {
		parsed = s.parseMovieFromDir(path, parsed)
	}

	parsed.TmdbID = s.resolveTmdbID(path, parsed, mediaType)

	groupID := s.resolveGroupID(path, libraryID)
	parsed.GroupID = groupID

	episodes := []ParsedMedia{parsed}
	if parsed.EpisodeEnd > parsed.EpisodeNumber && parsed.SeasonNumber > 0 {
		episodes = nil
		for ep := parsed.EpisodeNumber; ep <= parsed.EpisodeEnd; ep++ {
			e := parsed
			e.EpisodeNumber = ep
			e.EpisodeEnd = 0
			e.Title = fmt.Sprintf("%s S%02dE%02d", parsed.ShowName, parsed.SeasonNumber, ep)
			episodes = append(episodes, e)
		}
	}

	tmdbID := parsed.TmdbID

	if existingID > 0 {
		s.db.Exec(`UPDATE media_items SET duration_seconds = ? WHERE file_path = ?`, duration, path)
		log.Printf("Scanner: updated duration for %s (path=%s, duration=%ds)", parsed.Title, path, duration)
		return
	}

	for _, ep := range episodes {
		title := ep.Title
		var insertSQL string
		var insertArgs []any

		if libraryID > 0 {
			insertSQL = `INSERT INTO media_items (library_id, title, file_path, duration_seconds, media_type, show_name, season_number, episode_number, episode_title, year, tmdb_id, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			insertArgs = []any{libraryID, title, path, duration, mediaType, ep.ShowName, ep.SeasonNumber, ep.EpisodeNumber, ep.EpisodeTitle, ep.Year, tmdbID, groupID}
		} else {
			insertSQL = `INSERT INTO media_items (title, file_path, duration_seconds, media_type, show_name, season_number, episode_number, episode_title, year, tmdb_id, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			insertArgs = []any{title, path, duration, mediaType, ep.ShowName, ep.SeasonNumber, ep.EpisodeNumber, ep.EpisodeTitle, ep.Year, tmdbID, groupID}
		}

		res, err := s.db.Exec(insertSQL, insertArgs...)
		if err != nil {
			log.Printf("Scanner: insert error %s: %v", path, err)
			continue
		}

		id, _ := res.LastInsertId()
		log.Printf("Scanner: added %s (id=%d, library=%d, type=%s, duration=%ds)", title, id, libraryID, mediaType, duration)

		s.encoderCh <- EncoderJob{MediaID: id, FilePath: path}

		s.detectLocalImages(id, path, ep.ShowName, ep.SeasonNumber, mediaType)
		s.detectSubtitles(id, path)
		s.storeAudioTracks(id, result.Streams)
	}
}

func (s *Scanner) parseMovieFromDir(path string, fallback ParsedMedia) ParsedMedia {
	dir := filepath.Dir(path)
	rel, err := filepath.Rel(s.cfg.MediaDir, dir)
	if err != nil || rel == "." {
		return fallback
	}
	parts := strings.SplitN(rel, string(filepath.Separator), 2)
	if len(parts) < 1 {
		return fallback
	}
	dirName := parts[len(parts)-1]
	if dirName == "" || dirName == "." {
		return fallback
	}

	cleaned := strings.ToLower(dirName)
	cleaned = stripQualityTags(cleaned)
	cleaned = strings.TrimSpace(yearRe.ReplaceAllString(cleaned, ""))
	cleaned = strings.TrimSpace(strings.TrimRight(cleaned, " .-_"))

	year := extractYearFromDir(dirName)

	var result ParsedMedia
	result.Title = titleCase(cleaned)
	result.Year = year
	if year != "" {
		result.Title = strings.TrimSpace(result.Title + " (" + year + ")")
	}
	result.TmdbID = extractTmdbIDFromPath(dir, s.cfg.MediaDir, "movie")
	if result.Title == "" || result.Title == " " {
		return fallback
	}
	return result
}

func (s *Scanner) resolveTmdbID(path string, parsed ParsedMedia, mediaType string) int64 {
	dir := filepath.Dir(path)

	if id := readTmdbIDFile(dir); id > 0 {
		return id
	}
	parentDir := filepath.Dir(dir)
	if parentDir != dir {
		if id := readTmdbIDFile(parentDir); id > 0 {
			return id
		}
	}
	if id := extractTmdbIDFromPath(path, s.cfg.MediaDir, mediaType); id > 0 {
		return id
	}
	return 0
}

func readTmdbIDFile(dir string) int64 {
	p := filepath.Join(dir, ".tmdbid")
	data, err := os.ReadFile(p)
	if err != nil {
		return 0
	}
	id, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return 0
	}
	return id
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
		if videoExts[ext] {
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

func (s *Scanner) detectLocalImages(mediaID int64, filePath, showName string, seasonNumber int, mediaType string) {
	dir := filepath.Dir(filePath)
	posterNames := []string{"poster.jpg", "poster.png", "folder.jpg", "folder.png", "cover.jpg", "movie.jpg"}
	backdropNames := []string{"backdrop.jpg", "backdrop.png", "fanart.jpg", "background.jpg"}

	for _, name := range posterNames {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); err == nil {
			s.db.Exec(`INSERT OR IGNORE INTO media_images (media_id, image_type, file_path, is_primary) VALUES (?, 'poster', ?, 1)`, mediaID, p)
			break
		}
	}

	for _, name := range backdropNames {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); err == nil {
			s.db.Exec(`INSERT OR IGNORE INTO media_images (media_id, image_type, file_path, is_primary) VALUES (?, 'backdrop', ?, 1)`, mediaID, p)
			break
		}
	}

	if showName != "" && mediaType == "tv" {
		parentDir := filepath.Dir(dir)
		if seasonNumber > 0 {
			seasonPosters := []string{
				fmt.Sprintf("season%02d-poster.jpg", seasonNumber),
				fmt.Sprintf("season%d-poster.jpg", seasonNumber),
				fmt.Sprintf("Season%02d-poster.jpg", seasonNumber),
			}
			for _, name := range seasonPosters {
				p := filepath.Join(parentDir, name)
				if _, err := os.Stat(p); err == nil {
					s.db.Exec(`INSERT OR IGNORE INTO show_images (show_name, image_type, season_number, file_path) VALUES (?, 'season_poster', ?, ?)`, showName, seasonNumber, p)
					break
				}
			}
		}

		showPosterNames := append(posterNames, "show.jpg", "tvshow.jpg")
		for _, name := range showPosterNames {
			p := filepath.Join(parentDir, name)
			if _, err := os.Stat(p); err == nil {
				s.db.Exec(`INSERT OR IGNORE INTO show_images (show_name, image_type, season_number, file_path) VALUES (?, 'poster', 0, ?)`, showName, p)
				break
			}
		}
		for _, name := range backdropNames {
			p := filepath.Join(parentDir, name)
			if _, err := os.Stat(p); err == nil {
				s.db.Exec(`INSERT OR IGNORE INTO show_images (show_name, image_type, season_number, file_path) VALUES (?, 'backdrop', 0, ?)`, showName, p)
				break
			}
		}
	}
}

var subtitleExts = map[string]string{
	".srt":  "srt",
	".vtt":  "vtt",
	".ass":  "ass",
	".ssa":  "ssa",
	".sub":  "sub",
	".idx":  "idx",
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
				} else if len(lower) == 2 || len(lower) == 3 {
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
	cmd := exec.Command("ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		"-analyzeduration", "100M",
		"-probesize", "50M",
		path,
	)
	out, err := cmd.Output()
	if err != nil {
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
	cmd := exec.Command("ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		"-analyzeduration", "100M",
		"-probesize", "50M",
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
