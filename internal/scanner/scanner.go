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
	libraries := s.ensureLibraries()
	if len(libraries) == 0 {
		log.Println("Scanner: no library directories found under", s.cfg.MediaDir)
		return
	}

	for dir, lib := range libraries {
		fullPath := filepath.Join(s.cfg.MediaDir, dir)
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
			return nil
		})
	}

	log.Println("Scanner: full scan complete")
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

	var duration int
	var durationFloat float64
	if _, err := fmt.Sscanf(result.Format.Duration, "%f", &durationFloat); err == nil {
		duration = int(durationFloat)
	} else {
		log.Printf("Scanner: parse duration %s: %v", result.Format.Duration, err)
	}

	var insertSQL string
	var insertArgs []any

	parsed := ParseMedia(path, mediaType, s.cfg.MediaDir)
	title := parsed.Title

	if libraryID > 0 {
		insertSQL = `INSERT INTO media_items (library_id, title, file_path, duration_seconds, media_type, show_name, season_number, episode_number, episode_title, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		insertArgs = []any{libraryID, title, path, duration, mediaType, parsed.ShowName, parsed.SeasonNumber, parsed.EpisodeNumber, parsed.EpisodeTitle, parsed.Year}
	} else {
		insertSQL = `INSERT INTO media_items (title, file_path, duration_seconds, media_type, show_name, season_number, episode_number, episode_title, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		insertArgs = []any{title, path, duration, mediaType, parsed.ShowName, parsed.SeasonNumber, parsed.EpisodeNumber, parsed.EpisodeTitle, parsed.Year}
	}

	res, err := s.db.Exec(insertSQL, insertArgs...)
	if err != nil {
		log.Printf("Scanner: insert error %s: %v", path, err)
		return
	}

	id, _ := res.LastInsertId()
	log.Printf("Scanner: added %s (id=%d, library=%d, type=%s, duration=%ds)", title, id, libraryID, mediaType, duration)

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
