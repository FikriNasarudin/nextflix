package admin

import (
	"database/sql"
	"net/http"
)

type StatsHandler struct {
	db *sql.DB
}

func NewStatsHandler(db *sql.DB) *StatsHandler {
	return &StatsHandler{db: db}
}

type EnrichmentInfo struct {
	WithTmdbID   int `json:"with_tmdb_id"`
	WithPoster   int `json:"with_poster"`
	WithOverview int `json:"with_overview"`
	Total        int `json:"total"`
}

type MediaCounts struct {
	Total             int            `json:"total"`
	Movies            int            `json:"movies"`
	TVShows           int            `json:"tv_shows"`
	Episodes          int            `json:"episodes"`
	Seasons           int            `json:"seasons"`
	MoviesEnrichment  EnrichmentInfo `json:"movies_enrichment"`
	TVEnrichment      EnrichmentInfo `json:"tv_enrichment"`
}

type OptimizationStats struct {
	Optimized  int `json:"optimized"`
	Pending     int `json:"pending"`
	InProgress  int `json:"in_progress"`
	Failed      int `json:"failed"`
	Stale       int `json:"stale"`
	TotalSize   int64 `json:"total_size_bytes"`
	QueueLength int `json:"queue_length"`
}

type Stats struct {
	Media         MediaCounts       `json:"media"`
	Users         int               `json:"users"`
	Libraries     int               `json:"libraries"`
	Optimization  OptimizationStats `json:"optimization"`
}

func (h *StatsHandler) Get(w http.ResponseWriter, r *http.Request) {
	var stats Stats

	rows, err := h.db.Query(`SELECT media_type, COUNT(*) as cnt FROM media_items GROUP BY media_type`)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var mediaType string
		var count int
		if err := rows.Scan(&mediaType, &count); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		switch mediaType {
		case "movie":
			stats.Media.Movies = count
			stats.Media.MoviesEnrichment.Total = count
		case "tv":
			stats.Media.Episodes = count
			stats.Media.TVEnrichment.Total = count
		}
		stats.Media.Total += count
	}
	if err := rows.Err(); err != nil {
		writeError(w, "rows error", http.StatusInternalServerError)
		return
	}

	h.db.QueryRow(`SELECT COUNT(DISTINCT show_name) FROM media_items WHERE media_type = 'tv' AND show_name != ''`).Scan(&stats.Media.TVShows)
	h.db.QueryRow(`SELECT COUNT(DISTINCT show_name || ':' || season_number) FROM media_items WHERE media_type = 'tv' AND show_name != '' AND season_number > 0`).Scan(&stats.Media.Seasons)

	h.db.QueryRow(`SELECT COUNT(*) FROM media_items WHERE media_type = 'movie' AND tmdb_id IS NOT NULL AND tmdb_id != 0`).Scan(&stats.Media.MoviesEnrichment.WithTmdbID)
	h.db.QueryRow(`SELECT COUNT(*) FROM media_items WHERE media_type = 'movie' AND poster_path != ''`).Scan(&stats.Media.MoviesEnrichment.WithPoster)
	h.db.QueryRow(`SELECT COUNT(*) FROM media_items WHERE media_type = 'movie' AND overview != ''`).Scan(&stats.Media.MoviesEnrichment.WithOverview)
	h.db.QueryRow(`SELECT COUNT(*) FROM media_items WHERE media_type = 'tv' AND tmdb_id IS NOT NULL AND tmdb_id != 0`).Scan(&stats.Media.TVEnrichment.WithTmdbID)
	h.db.QueryRow(`SELECT COUNT(*) FROM media_items WHERE media_type = 'tv' AND poster_path != ''`).Scan(&stats.Media.TVEnrichment.WithPoster)
	h.db.QueryRow(`SELECT COUNT(*) FROM media_items WHERE media_type = 'tv' AND overview != ''`).Scan(&stats.Media.TVEnrichment.WithOverview)

	if err := h.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&stats.Users); err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}

	if err := h.db.QueryRow(`SELECT COUNT(*) FROM libraries`).Scan(&stats.Libraries); err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}

	stats.Optimization.Optimized = h.countMedia(`WHERE hls_480p_path != '' AND hls_480p_path IS NOT NULL`)
	stats.Optimization.Pending = h.countMedia(`WHERE (hls_480p_path = '' OR hls_480p_path IS NULL)`)
	stats.Optimization.InProgress = h.countJobs(`status = 'in_progress'`)
	stats.Optimization.Failed = h.countJobs(`status = 'failed'`)
	stats.Optimization.QueueLength = h.countJobs(`status = 'queued'`)
	stats.Optimization.Stale = h.countMedia(`WHERE hls_stale = 1 AND hls_480p_path != '' AND hls_480p_path IS NOT NULL`)
	h.db.QueryRow(`SELECT COALESCE(SUM(output_size), 0) FROM encode_jobs`).Scan(&stats.Optimization.TotalSize)

	writeJSON(w, stats)
}

func (h *StatsHandler) countMedia(where string) int {
	var c int
	h.db.QueryRow(`SELECT COUNT(*) FROM media_items ` + where).Scan(&c)
	return c
}

func (h *StatsHandler) countJobs(where string) int {
	var c int
	h.db.QueryRow(`SELECT COUNT(DISTINCT media_id) FROM encode_jobs WHERE ` + where).Scan(&c)
	return c
}
