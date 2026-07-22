package handler

import (
	"database/sql"
	"net/http"
)

type TrendingHandler struct {
	db *sql.DB
}

func NewTrendingHandler(db *sql.DB) *TrendingHandler {
	return &TrendingHandler{db: db}
}

func (h *TrendingHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`
		SELECT tc.tmdb_id, tc.title, tc.poster_path, tc.media_type, tc.rank, tc.updated_at,
		       COALESCE(mi.id, 0) as id
		FROM trending_cache tc
		LEFT JOIN media_items mi ON mi.tmdb_id = tc.tmdb_id AND mi.media_type = tc.media_type
		ORDER BY tc.rank ASC
		LIMIT 10
	`)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type item struct {
		ID         int64  `json:"id"`
		TmdbID     int64  `json:"tmdb_id"`
		Title      string `json:"title"`
		PosterPath string `json:"poster_path"`
		MediaType  string `json:"media_type"`
		Rank       int    `json:"rank"`
		UpdatedAt  string `json:"updated_at"`
	}

	var items []item
	for rows.Next() {
		var i item
		rows.Scan(&i.TmdbID, &i.Title, &i.PosterPath, &i.MediaType, &i.Rank, &i.UpdatedAt, &i.ID)
		items = append(items, i)
	}
	if items == nil {
		items = []item{}
	}
	writeJSON(w, items)
}
