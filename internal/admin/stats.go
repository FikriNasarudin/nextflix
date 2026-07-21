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

type MediaCounts struct {
	Total   int `json:"total"`
	Movies  int `json:"movies"`
	TVShows int `json:"tv_shows"`
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
		case "tv":
			stats.Media.TVShows = count
		}
		stats.Media.Total += count
	}
	if err := rows.Err(); err != nil {
		writeError(w, "rows error", http.StatusInternalServerError)
		return
	}

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
