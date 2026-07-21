package library

import (
	"context"
	"database/sql"
	"log"
	"os"
	"path/filepath"

	"nextflix/internal/config"
	"nextflix/internal/model"
	"nextflix/internal/provider"
	"nextflix/internal/resolver"
	"nextflix/internal/scanner"
)

type LibraryManager struct {
	db        *sql.DB
	cfg       *config.Config
	scanner   *scanner.Scanner
	resolver  *resolver.ResolverChain
	provider  *provider.ProviderManager
	encoderCh chan<- scanner.EncoderJob
}

func New(db *sql.DB, cfg *config.Config, encoderCh chan<- scanner.EncoderJob) *LibraryManager {
	dirs := []string{
		cfg.Data.Dir,
		cfg.Data.MetadataDir,
		cfg.Data.ImageCacheDir,
		cfg.Data.CollectionsDir,
		cfg.Encoder.HLSOutputDir,
		filepath.Join(filepath.Dir(cfg.Database.Path), "images"),
	}
	for _, d := range dirs {
		if d == "" {
			continue
		}
		if err := os.MkdirAll(d, 0755); err != nil {
			log.Printf("Library: cannot create %s: %v", d, err)
		}
	}

	namingOpts := resolver.DefaultNamingOptions()
	resolverChain := resolver.NewResolverChain(namingOpts)

	imageCache := provider.NewImageCacheManager(cfg.Data.MetadataDir, cfg.Data.ImageCacheDir, db)
	provMgr := provider.NewProviderManager(db, imageCache)

	apiKey := cfg.Integrations.TmdbAPIKey
	if apiKey == "" || apiKey == "change-me-to-a-real-key" {
		db.QueryRow(`SELECT value FROM settings WHERE key = 'tmdb_api_key'`).Scan(&apiKey)
	}
	if apiKey != "" && apiKey != "change-me-to-a-real-key" && apiKey != "YOUR_TMDB_API_KEY_HERE" {
		tmdbProv := provider.NewTMDBProvider(db, apiKey, imageCache)
		provMgr.RegisterMetadata(tmdbProv)
		log.Println("Library: TMDB provider registered")
	} else {
		log.Println("Library: TMDB provider skipped (no API key)")
	}

	scn := scanner.New(
		db,
		cfg.Scanner,
		namingOpts,
		encoderCh,
		filepath.Join(filepath.Dir(cfg.Database.Path), "images"),
	)

	return &LibraryManager{
		db:        db,
		cfg:       cfg,
		scanner:   scn,
		resolver:  resolverChain,
		provider:  provMgr,
		encoderCh: encoderCh,
	}
}

func (m *LibraryManager) ValidateLibrary() {
	m.scanner.ScanAll(func(path string) *resolver.ResolveResult {
		result, err := m.resolver.Resolve(path, m.cfg.Scanner.MediaDir)
		if err != nil {
			log.Printf("Library: resolve error %s: %v", path, err)
			return nil
		}
		return result
	})
}

func (m *LibraryManager) StartWatcher() {
	m.scanner.Watch(func(path string) *resolver.ResolveResult {
		result, err := m.resolver.Resolve(path, m.cfg.Scanner.MediaDir)
		if err != nil {
			log.Printf("Library: resolve error %s: %v", path, err)
			return nil
		}
		return result
	})
}

func (m *LibraryManager) RefreshMetadata() {
	log.Println("Library: starting metadata refresh")
	ctx := context.Background()

	rows, err := m.db.Query(`
		SELECT id, library_id, title, media_type, tmdb_id, rating, file_path,
			duration_seconds, trailer_youtube_id, backdrop_path, poster_path,
			show_name, season_number, episode_number, episode_title, year, created_at, overview
		FROM media_items
		WHERE (overview = '' OR overview IS NULL) OR (tmdb_id IS NULL OR tmdb_id = 0)
	`)
	if err != nil {
		log.Printf("Library: refresh query error: %v", err)
		return
	}
	defer rows.Close()

	var items []*model.MediaItem
	for rows.Next() {
		item := &model.MediaItem{}
		var overview string
		if err := rows.Scan(
			&item.ID, &item.LibraryID, &item.Title, &item.MediaType, &item.TmdbID,
			&item.Rating, &item.FilePath, &item.DurationSeconds, &item.TrailerYoutubeID,
			&item.BackdropPath, &item.PosterPath, &item.ShowName, &item.SeasonNumber,
			&item.EpisodeNumber, &item.EpisodeTitle, &item.Year, &item.CreatedAt,
			&overview,
		); err != nil {
			log.Printf("Library: scan media item: %v", err)
			continue
		}
		items = append(items, item)
	}

	for _, item := range items {
		if err := m.provider.Refresh(ctx, item); err != nil {
			log.Printf("Library: refresh item %q: %v", item.Title, err)
		}
	}

	log.Printf("Library: metadata refresh complete, processed %d items", len(items))
}

func (m *LibraryManager) Scanner() *scanner.Scanner {
	return m.scanner
}

func (m *LibraryManager) Provider() *provider.ProviderManager {
	return m.provider
}
