package provider

import (
	"context"
	"database/sql"
	"log"
	"strconv"

	"nextflix/internal/model"
)

type ProviderManager struct {
	db         *sql.DB
	metadata   []IMetadataProvider
	imageFetch []ImageFetchService
	imageCache *ImageCacheManager
}

func NewProviderManager(db *sql.DB, imageCache *ImageCacheManager) *ProviderManager {
	return &ProviderManager{
		db:         db,
		imageCache: imageCache,
	}
}

func (pm *ProviderManager) RegisterMetadata(p IMetadataProvider) {
	pm.metadata = append(pm.metadata, p)
}

func (pm *ProviderManager) RegisterImage(f ImageFetchService) {
	pm.imageFetch = append(pm.imageFetch, f)
}

func (pm *ProviderManager) Refresh(ctx context.Context, item *model.MediaItem) error {
	var merged MetadataResult
	hasResult := false

	for _, p := range pm.metadata {
		result, err := p.Fetch(ctx, item)
		if err != nil {
			log.Printf("provider %s: fetch metadata for %q: %v", p.Name(), item.Title, err)
			continue
		}
		if result == nil {
			continue
		}
		hasResult = true

		if merged.Title == "" && result.Title != "" {
			merged.Title = result.Title
		}
		if merged.Overview == "" && result.Overview != "" {
			merged.Overview = result.Overview
		}
		if merged.Rating == "" && result.Rating != "" {
			merged.Rating = result.Rating
		}
		if merged.Year == 0 && result.Year != 0 {
			merged.Year = result.Year
		}
		if merged.TmdbID == 0 && result.TmdbID != 0 {
			merged.TmdbID = result.TmdbID
		}
		if merged.ImdbID == "" && result.ImdbID != "" {
			merged.ImdbID = result.ImdbID
		}
		if len(merged.Genres) == 0 && len(result.Genres) > 0 {
			merged.Genres = result.Genres
		}
		if merged.PosterPath == "" && result.PosterPath != "" {
			merged.PosterPath = result.PosterPath
		}
		if merged.BackdropPath == "" && result.BackdropPath != "" {
			merged.BackdropPath = result.BackdropPath
		}
		if merged.TrailerKey == "" && result.TrailerKey != "" {
			merged.TrailerKey = result.TrailerKey
		}
	}

	if !hasResult {
		return nil
	}

	if merged.TmdbID != 0 {
		pm.db.Exec(`UPDATE media_items SET tmdb_id = ? WHERE id = ? AND (tmdb_id IS NULL OR tmdb_id = 0)`,
			merged.TmdbID, item.ID)
	}
	if merged.Overview != "" {
		pm.db.Exec(`UPDATE media_items SET overview = ? WHERE id = ?`, merged.Overview, item.ID)
	}
	if merged.Rating != "" {
		pm.db.Exec(`UPDATE media_items SET rating = ? WHERE id = ?`, merged.Rating, item.ID)
	}
	if merged.Title != "" {
		pm.db.Exec(`UPDATE media_items SET title = ? WHERE id = ?`, merged.Title, item.ID)
	}
	if merged.Year != 0 {
		pm.db.Exec(`UPDATE media_items SET year = ? WHERE id = ?`, strconv.Itoa(merged.Year), item.ID)
	}
	if merged.PosterPath != "" {
		pm.db.Exec(`UPDATE media_items SET poster_path = ? WHERE id = ?`, merged.PosterPath, item.ID)
	}
	if merged.BackdropPath != "" {
		pm.db.Exec(`UPDATE media_items SET backdrop_path = ? WHERE id = ?`, merged.BackdropPath, item.ID)
	}
	if merged.TrailerKey != "" {
		pm.db.Exec(`UPDATE media_items SET trailer_youtube_id = ? WHERE id = ?`, merged.TrailerKey, item.ID)
	}
	for _, genre := range merged.Genres {
		var tagID int64
		err := pm.db.QueryRow(`SELECT id FROM tags WHERE name = ?`, genre).Scan(&tagID)
		if err == nil {
			pm.db.Exec(`INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)`, item.ID, tagID)
		}
	}

	for _, f := range pm.imageFetch {
		results, err := f.FetchImages(ctx, item)
		if err != nil {
			log.Printf("provider: fetch images for %q: %v", item.Title, err)
			continue
		}
		for _, img := range results {
			if img.LocalPath != "" {
				pm.db.Exec(`INSERT OR IGNORE INTO media_images (media_id, image_type, file_path, is_primary) VALUES (?, ?, ?, 1)`,
					item.ID, img.Type, img.LocalPath)
			}
		}
	}

	return nil
}

func (pm *ProviderManager) RefreshAll(ctx context.Context) error {
	rows, err := pm.db.Query(`
		SELECT id, library_id, title, media_type, tmdb_id, rating, file_path,
			duration_seconds, trailer_youtube_id, backdrop_path, poster_path,
			show_name, season_number, episode_number, episode_title, year, created_at
		FROM media_items
		WHERE tmdb_id > 0 AND (overview = '' OR overview IS NULL)
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var items []*model.MediaItem
	for rows.Next() {
		item := &model.MediaItem{}
		if err := rows.Scan(
			&item.ID, &item.LibraryID, &item.Title, &item.MediaType, &item.TmdbID,
			&item.Rating, &item.FilePath, &item.DurationSeconds, &item.TrailerYoutubeID,
			&item.BackdropPath, &item.PosterPath, &item.ShowName, &item.SeasonNumber,
			&item.EpisodeNumber, &item.EpisodeTitle, &item.Year, &item.CreatedAt,
		); err != nil {
			log.Printf("provider: scan media item: %v", err)
			continue
		}
		items = append(items, item)
	}

	for _, item := range items {
		if err := pm.Refresh(ctx, item); err != nil {
			log.Printf("provider: refresh item %q: %v", item.Title, err)
		}
	}

	log.Printf("provider: refresh-all complete, processed %d items", len(items))
	return nil
}
