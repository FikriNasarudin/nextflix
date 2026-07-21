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
	MoviesEnrichment  EnrichmentInfo `json:"movies_enrichment"`
	TVEnrichment      EnrichmentInfo `json:"tv_enrichment"`
}

type Stats struct {
	Media     MediaCounts `json:"media"`
	Users     int         `json:"users"`
	Libraries int         `json:"libraries"`
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
			stats.Media.TVShows = count
			stats.Media.TVEnrichment.Total = count
		}
		stats.Media.Total += count
	}
	if err := rows.Err(); err != nil {
		writeError(w, "rows error", http.StatusInternalServerError)
		return
	}

	h.db.QueryRow(`SELECT COUNT(*) FROM media_items WHERE media_type = 'movie' AND tmdb_id IS NOT NULL`).Scan(&stats.Media.MoviesEnrichment.WithTmdbID)
	h.db.QueryRow(`SELECT COUNT(*) FROM media_items WHERE media_type = 'movie' AND poster_path != ''`).Scan(&stats.Media.MoviesEnrichment.WithPoster)
	h.db.QueryRow(`SELECT COUNT(*) FROM media_items WHERE media_type = 'movie' AND overview != ''`).Scan(&stats.Media.MoviesEnrichment.WithOverview)
	h.db.QueryRow(`SELECT COUNT(*) FROM media_items WHERE media_type = 'tv' AND tmdb_id IS NOT NULL`).Scan(&stats.Media.TVEnrichment.WithTmdbID)
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

	writeJSON(w, stats)
}
