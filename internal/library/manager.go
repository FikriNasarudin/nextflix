package library

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"nextflix/internal/config"
	"nextflix/internal/model"
	"nextflix/internal/provider"
	"nextflix/internal/resolver"
	"nextflix/internal/scanner"
	"nextflix/internal/tmdb"
)

type LibraryManager struct {
	db        *sql.DB
	cfg       *config.Config
	scanner   *scanner.Scanner
	resolver  *resolver.ResolverChain
	provider  *provider.ProviderManager
	tmdbSync  *tmdb.Sync
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
		filepath.Join(cfg.Data.Dir, "subtitles"),
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

	tmdbClient := tmdb.NewClient(db)
	if key, err := tmdbClient.APIKey(); err == nil && key != "" {
		tmdbProv := provider.NewTMDBProvider(db, tmdbClient, imageCache)
		provMgr.RegisterMetadata(tmdbProv)
		log.Println("Library: TMDB provider registered")
	} else {
		log.Printf("Library: TMDB provider skipped: %v", err)
	}

	scn := scanner.New(
		db,
		cfg.Scanner,
		namingOpts,
		encoderCh,
		filepath.Join(filepath.Dir(cfg.Database.Path), "images"),
		filepath.Join(cfg.Data.Dir, "subtitles"),
	)

	return &LibraryManager{
		db:        db,
		cfg:       cfg,
		scanner:   scn,
		resolver:  resolverChain,
		provider:  provMgr,
		tmdbSync:  tmdb.NewSync(db),
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
		WHERE (overview = '' OR overview IS NULL) OR (tmdb_id IS NULL OR tmdb_id = 0) OR NOT EXISTS (SELECT 1 FROM media_credits WHERE media_id = media_items.id)
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

func (m *LibraryManager) RefreshItem(id int64) error {
	ctx := context.Background()

	item := &model.MediaItem{}
	var overview string
	err := m.db.QueryRow(`
		SELECT id, library_id, title, media_type, tmdb_id, rating, file_path,
			duration_seconds, trailer_youtube_id, backdrop_path, poster_path,
			show_name, season_number, episode_number, episode_title, year, created_at, overview
		FROM media_items WHERE id = ?`, id,
	).Scan(
		&item.ID, &item.LibraryID, &item.Title, &item.MediaType, &item.TmdbID,
		&item.Rating, &item.FilePath, &item.DurationSeconds, &item.TrailerYoutubeID,
		&item.BackdropPath, &item.PosterPath, &item.ShowName, &item.SeasonNumber,
		&item.EpisodeNumber, &item.EpisodeTitle, &item.Year, &item.CreatedAt,
		&overview,
	)
	if err == sql.ErrNoRows {
		return fmt.Errorf("media item %d not found", id)
	}
	if err != nil {
		return fmt.Errorf("load item %d: %w", id, err)
	}

	m.db.Exec(`UPDATE media_items SET overview='', poster_path='', backdrop_path='' WHERE id=?`, id)

	if err := m.provider.Refresh(ctx, item); err != nil {
		m.db.Exec(`UPDATE media_items SET enrich_status='failed', enrich_error=?, last_enriched_at=CURRENT_TIMESTAMP WHERE id=?`, err.Error(), id)
		return fmt.Errorf("provider refresh: %w", err)
	}

	m.tmdbSync.EnrichItemByID(ctx, id)

	m.db.Exec(`UPDATE media_items SET enrich_status='ok', enrich_error='', last_enriched_at=CURRENT_TIMESTAMP WHERE id=?`, id)
	return nil
}

func (m *LibraryManager) TmdbSync() *tmdb.Sync {
	return m.tmdbSync
}

func (m *LibraryManager) Scanner() *scanner.Scanner {
	return m.scanner
}

func (m *LibraryManager) Provider() *provider.ProviderManager {
	return m.provider
}
