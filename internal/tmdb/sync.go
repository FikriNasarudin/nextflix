package tmdb

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var yearSuffixRe = regexp.MustCompile(`\s*\(\d{4}\)\s*$`)

type Sync struct {
	db  *sql.DB
	cli *Client
}

func NewSync(db *sql.DB) *Sync {
	return &Sync{db: db, cli: NewClient(db)}
}

func (s *Sync) Start() {
	go s.run()
}

func (s *Sync) Trigger() {
	go s.sync()
}

func (s *Sync) run() {
	s.sync()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		s.sync()
	}
}

func (s *Sync) sync() {
	log.Println("TMDB: starting sync")

	if err := s.syncTrending(); err != nil {
		log.Printf("TMDB: trending error: %v", err)
	}
	if err := s.syncGenres(); err != nil {
		log.Printf("TMDB: genres error: %v", err)
	}
	if err := s.resolveMissingTmdbIDs(); err != nil {
		log.Printf("TMDB: resolve IDs error: %v", err)
	}
	if err := s.enrichMedia(); err != nil {
		log.Printf("TMDB: enrich error: %v", err)
	}

	log.Println("TMDB: sync complete")
}

func cleanSearchTitle(title string) string {
	t := yearSuffixRe.ReplaceAllString(title, "")
	t = strings.TrimSpace(t)
	return t
}

type searchResult struct {
	Results []struct {
		ID           int64   `json:"id"`
		Title        string  `json:"title"`
		Name         string  `json:"name"`
		ReleaseDate  string  `json:"release_date"`
		FirstAirDate string  `json:"first_air_date"`
		Popularity   float64 `json:"popularity"`
	} `json:"results"`
}

func (s *Sync) resolveMissingTmdbIDs() error {
	rows, err := s.db.Query(`SELECT id, title, year, media_type, show_name, enrich_status, resolve_attempts, last_enriched_at FROM media_items WHERE (tmdb_id IS NULL OR tmdb_id = 0) AND title != '' AND title != 'Unknown'`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type missingRow struct {
		ID              int64
		Title           string
		Year            string
		MediaType       string
		ShowName        string
		EnrichStatus    string
		ResolveAttempts int
		LastEnrichedAt  string
	}
	var missing []missingRow
	for rows.Next() {
		var m missingRow
		rows.Scan(&m.ID, &m.Title, &m.Year, &m.MediaType, &m.ShowName, &m.EnrichStatus, &m.ResolveAttempts, &m.LastEnrichedAt)
		missing = append(missing, m)
	}

	found := 0
	for _, m := range missing {
		if m.EnrichStatus == "missing" && m.ResolveAttempts >= 3 {
			s.db.Exec(`UPDATE media_items SET enrich_status='missing', resolve_attempts=resolve_attempts+1 WHERE id=?`, m.ID)
			continue
		}

		searchTitle := m.Title
		if m.MediaType == "tv" && m.ShowName != "" {
			searchTitle = m.ShowName
		}
		searchTitle = cleanSearchTitle(searchTitle)

		id, err := s.searchTmdb(searchTitle, m.Year, m.MediaType)
		if err != nil {
			log.Printf("TMDB: resolve miss id=%d title=%q year=%q err=%v", m.ID, m.Title, m.Year, err)
			s.db.Exec(`UPDATE media_items SET resolve_attempts = resolve_attempts + 1, enrich_status='missing', enrich_error=?, last_enriched_at=CURRENT_TIMESTAMP WHERE id=?`, err.Error(), m.ID)
			continue
		}
		s.db.Exec(`UPDATE media_items SET tmdb_id = ?, enrich_status='ok', enrich_error='', resolve_attempts=0, last_enriched_at=CURRENT_TIMESTAMP WHERE id=?`, id, m.ID)
		found++
	}

	if found > 0 {
		log.Printf("TMDB: resolved %d/%d missing tmdb_ids", found, len(missing))
	}
	return nil
}

func (s *Sync) searchTmdb(title, year, mediaType string) (int64, error) {
	query := url.QueryEscape(title)
	path := fmt.Sprintf("/search/%s?query=%s", mediaTypePath(mediaType), query)
	if year != "" {
		yearParam := "year"
		if mediaType == "tv" {
			yearParam = "first_air_date_year"
		}
		path += fmt.Sprintf("&%s=%s", yearParam, year)
	}

	var result searchResult
	if err := s.cli.Get(path, &result); err != nil {
		return 0, err
	}

	if len(result.Results) > 0 {
		return result.Results[0].ID, nil
	}
	return 0, fmt.Errorf("no results for %s", title)
}

type trendingResponse struct {
	Results []struct {
		ID         int64   `json:"id"`
		Title      string  `json:"title"`
		Name       string  `json:"name"`
		MediaType  string  `json:"media_type"`
		PosterPath string  `json:"poster_path"`
		BackdropPath string `json:"backdrop_path"`
		Popularity float64 `json:"popularity"`
	}
}

func (s *Sync) syncTrending() error {
	var resp trendingResponse
	if err := s.cli.Get("/trending/all/day", &resp); err != nil {
		return err
	}

	for i, item := range resp.Results {
		title := item.Title
		if title == "" {
			title = item.Name
		}
		rank := i + 1
		_, err := s.db.Exec(`
			INSERT INTO trending_cache (tmdb_id, title, poster_path, media_type, rank, updated_at)
			VALUES (?, ?, ?, ?, ?, datetime('now'))
			ON CONFLICT(tmdb_id) DO UPDATE SET
				title = excluded.title,
				poster_path = excluded.poster_path,
				media_type = excluded.media_type,
				rank = excluded.rank,
				updated_at = excluded.updated_at
		`, item.ID, title, item.PosterPath, item.MediaType, rank)
		if err != nil {
			log.Printf("TMDB: upsert trending %d: %v", item.ID, err)
		}
	}

	log.Printf("TMDB: synced %d trending items", len(resp.Results))
	return nil
}

type genreListResponse struct {
	Genres []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
}

func (s *Sync) syncGenres() error {
	var movieResp, tvResp genreListResponse

	if err := s.cli.Get("/genre/movie/list", &movieResp); err != nil {
		return err
	}
	if err := s.cli.Get("/genre/tv/list", &tvResp); err != nil {
		return err
	}

	count := 0
	for _, g := range movieResp.Genres {
		_, err := s.db.Exec(`INSERT INTO tags (name, tmdb_genre_id) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`, g.Name, g.ID)
		if err == nil {
			count++
		}
	}
	for _, g := range tvResp.Genres {
		_, err := s.db.Exec(`INSERT INTO tags (name, tmdb_genre_id) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`, g.Name, g.ID)
		if err == nil {
			count++
		}
	}

	log.Printf("TMDB: synced %d genres", count)
	return nil
}

type mediaRow struct {
	ID        int64
	TmdbID    int64
	MediaType string
}

func (s *Sync) enrichMedia() error {
	rows, err := s.db.Query(`SELECT id, tmdb_id, media_type FROM media_items WHERE tmdb_id IS NOT NULL AND tmdb_id != 0 AND (overview = '' OR overview IS NULL OR poster_path = '' OR poster_path IS NULL)`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var media []mediaRow
	for rows.Next() {
		var m mediaRow
		rows.Scan(&m.ID, &m.TmdbID, &m.MediaType)
		media = append(media, m)
	}

	for _, m := range media {
		s.enrichItem(m)
	}

	log.Printf("TMDB: enriched %d media items", len(media))
	return nil
}

type collectionInfo struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	PosterPath   string `json:"poster_path"`
	BackdropPath string `json:"backdrop_path"`
}

type detailResponse struct {
	ID              int64           `json:"id"`
	Title           string          `json:"title"`
	Name            string          `json:"name"`
	Overview        string          `json:"overview"`
	PosterPath      string          `json:"poster_path"`
	BackdropPath    string          `json:"backdrop_path"`
	GenreIDs        []int64         `json:"genre_ids"`
	BelongsToCollection *collectionInfo `json:"belongs_to_collection"`
	Genres       []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	} `json:"genres"`
}

type releaseDatesResponse struct {
	Results []struct {
		ISO3166_1    string `json:"iso_3166_1"`
		ReleaseDates []struct {
			Certification string `json:"certification"`
		} `json:"release_dates"`
	} `json:"results"`
}

type contentRatingsResponse struct {
	Results []struct {
		ISO3166_1 string `json:"iso_3166_1"`
		Rating    string `json:"rating"`
	} `json:"results"`
}

type videosResponse struct {
	Results []struct {
		Key      string `json:"key"`
		Site     string `json:"site"`
		Type     string `json:"type"`
		Official bool   `json:"official"`
	} `json:"results"`
}

func (s *Sync) enrichItem(m mediaRow) {
	ctx := context.Background()
	detailPath := fmt.Sprintf("/%s/%d", mediaTypePath(m.MediaType), m.TmdbID)
	var detail detailResponse
	if err := s.cli.GetContext(ctx, detailPath, &detail); err != nil {
		log.Printf("TMDB: detail %s: %v", detailPath, err)
		s.db.Exec(`UPDATE media_items SET enrich_status='failed', enrich_error=?, last_enriched_at=CURRENT_TIMESTAMP WHERE id=?`, err.Error(), m.ID)
		return
	}

	if detail.Overview != "" {
		s.db.Exec(`UPDATE media_items SET overview = ? WHERE id = ?`, detail.Overview, m.ID)
	}

	if detail.PosterPath != "" || detail.BackdropPath != "" {
		s.db.Exec(`UPDATE media_items SET poster_path = ?, backdrop_path = ? WHERE id = ?`,
			detail.PosterPath, detail.BackdropPath, m.ID)
	}

	var genreIDs []int64
	for _, g := range detail.Genres {
		genreIDs = append(genreIDs, g.ID)
	}
	if len(detail.GenreIDs) > 0 {
		genreIDs = detail.GenreIDs
	}

	for _, gid := range genreIDs {
		var tagID int64
		err := s.db.QueryRow(`SELECT id FROM tags WHERE tmdb_genre_id = ?`, gid).Scan(&tagID)
		if err == nil {
			s.db.Exec(`INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)`, m.ID, tagID)
		}
	}

	ratingPath := fmt.Sprintf("/%s/%d/release_dates", mediaTypePath(m.MediaType), m.TmdbID)
	if m.MediaType == "movie" {
		var rd releaseDatesResponse
		if err := s.cli.GetContext(ctx, ratingPath, &rd); err == nil {
			for _, r := range rd.Results {
				if r.ISO3166_1 == "US" && len(r.ReleaseDates) > 0 {
					if cert := r.ReleaseDates[0].Certification; cert != "" {
						s.db.Exec(`UPDATE media_items SET rating = ? WHERE id = ?`, cert, m.ID)
						break
					}
				}
			}
		}
	} else {
		var cr contentRatingsResponse
		if err := s.cli.GetContext(ctx, fmt.Sprintf("/tv/%d/content_ratings", m.TmdbID), &cr); err == nil {
			for _, r := range cr.Results {
				if r.ISO3166_1 == "US" && r.Rating != "" {
					s.db.Exec(`UPDATE media_items SET rating = ? WHERE id = ?`, r.Rating, m.ID)
					break
				}
			}
		}
	}

	videosPath := fmt.Sprintf("/%s/%d/videos", mediaTypePath(m.MediaType), m.TmdbID)
	var vv videosResponse
	if err := s.cli.GetContext(ctx, videosPath, &vv); err == nil {
		for _, v := range vv.Results {
			if v.Site == "YouTube" && v.Type == "Trailer" && v.Official {
				s.db.Exec(`UPDATE media_items SET trailer_youtube_id = ? WHERE id = ?`, v.Key, m.ID)
				break
			}
		}
	}

	if m.MediaType == "movie" && detail.BelongsToCollection != nil {
		coll := detail.BelongsToCollection

		var collOverview string
		var collDetail struct {
			Overview string `json:"overview"`
		}
		if err := s.cli.GetContext(ctx, fmt.Sprintf("/collection/%d", coll.ID), &collDetail); err == nil {
			collOverview = collDetail.Overview
		}

		s.db.Exec(`
			INSERT INTO collections (tmdb_collection_id, name, poster_path, backdrop_path, overview)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(tmdb_collection_id) DO UPDATE SET
				name = excluded.name,
				poster_path = excluded.poster_path,
				backdrop_path = excluded.backdrop_path,
				overview = excluded.overview
		`, coll.ID, coll.Name, coll.PosterPath, coll.BackdropPath, collOverview)

		var collID int64
		s.db.QueryRow(`SELECT id FROM collections WHERE tmdb_collection_id = ?`, coll.ID).Scan(&collID)
		if collID > 0 {
			var count int
			s.db.QueryRow(`SELECT COUNT(*) FROM collection_items WHERE collection_id = ? AND media_id = ?`, collID, m.ID).Scan(&count)
			if count == 0 {
				var maxOrder int
				s.db.QueryRow(`SELECT COALESCE(MAX(sort_order), -1) FROM collection_items WHERE collection_id = ?`, collID).Scan(&maxOrder)
				s.db.Exec(`INSERT INTO collection_items (collection_id, media_id, sort_order) VALUES (?, ?, ?)`, collID, m.ID, maxOrder+1)
			}
		}
	}

	s.db.Exec(`UPDATE media_items SET enrich_status='ok', enrich_error='', last_enriched_at=CURRENT_TIMESTAMP WHERE id=?`, m.ID)
}

func (s *Sync) EnrichItemByID(ctx context.Context, id int64) error {
	var m struct {
		ID        int64
		TmdbID    int64
		MediaType string
	}
	err := s.db.QueryRow(`SELECT id, COALESCE(tmdb_id, 0), media_type FROM media_items WHERE id = ?`, id).Scan(&m.ID, &m.TmdbID, &m.MediaType)
	if err == sql.ErrNoRows {
		return fmt.Errorf("media item %d not found", id)
	}
	if err != nil {
		return fmt.Errorf("loading media item %d: %w", id, err)
	}

	if m.TmdbID == 0 {
		var title, year, mediaType, showName string
		s.db.QueryRow(`SELECT title, year, media_type, show_name FROM media_items WHERE id = ?`, id).Scan(&title, &year, &mediaType, &showName)
		searchTitle := title
		if mediaType == "tv" && showName != "" {
			searchTitle = showName
		}
		searchTitle = cleanSearchTitle(searchTitle)

		tmdbID, err := s.searchTmdb(searchTitle, year, mediaType)
		if err != nil {
			s.db.Exec(`UPDATE media_items SET resolve_attempts=resolve_attempts+1, enrich_status='missing', enrich_error=?, last_enriched_at=CURRENT_TIMESTAMP WHERE id=?`, err.Error(), id)
			return fmt.Errorf("search tmdb for id=%d: %w", id, err)
		}
		s.db.Exec(`UPDATE media_items SET tmdb_id=?, enrich_status='pending', enrich_error='', resolve_attempts=0 WHERE id=?`, tmdbID, id)
		m.TmdbID = tmdbID
	}

	s.db.Exec(`UPDATE media_items SET overview='', poster_path='', backdrop_path='' WHERE id=?`, id)
	s.enrichItem(mediaRow{ID: id, TmdbID: m.TmdbID, MediaType: m.MediaType})
	return nil
}

func mediaTypePath(t string) string {
	if t == "movie" {
		return "movie"
	}
	return "tv"
}
