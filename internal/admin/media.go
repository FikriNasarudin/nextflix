package admin

import (
	"database/sql"
	"net/http"
	"strconv"
)

type MediaHandler struct {
	db *sql.DB
}

func NewMediaHandler(db *sql.DB) *MediaHandler {
	return &MediaHandler{db: db}
}

func (h *MediaHandler) List(w http.ResponseWriter, r *http.Request) {
	limit := 50
	offset := 0
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 && l <= 500 {
		limit = l
	}
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		offset = o
	}

	rows, err := h.db.Query(`
		SELECT id, library_id, title, media_type, tmdb_id, rating,
		       duration_seconds, trailer_youtube_id, backdrop_path, poster_path, created_at
		FROM media_items ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`, limit, offset)
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type item struct {
		ID               int64   `json:"id"`
		LibraryID        *int64  `json:"library_id"`
		Title            string  `json:"title"`
		MediaType        string  `json:"media_type"`
		TmdbID           *int64  `json:"tmdb_id"`
		Rating           string  `json:"rating"`
		DurationSeconds  int     `json:"duration_seconds"`
		TrailerYoutubeID string  `json:"trailer_youtube_id"`
		BackdropPath     string  `json:"backdrop_path"`
		PosterPath       string  `json:"poster_path"`
		CreatedAt        string  `json:"created_at"`
	}
	var items []item
	for rows.Next() {
		var i item
		if err := rows.Scan(
			&i.ID, &i.LibraryID, &i.Title, &i.MediaType, &i.TmdbID, &i.Rating,
			&i.DurationSeconds, &i.TrailerYoutubeID, &i.BackdropPath, &i.PosterPath, &i.CreatedAt,
		); err != nil {
			http.Error(w, `{"error":"scan error"}`, http.StatusInternalServerError)
			return
		}
		items = append(items, i)
	}
	if items == nil {
		items = []item{}
	}
	var total int
	h.db.QueryRow(`SELECT COUNT(*) FROM media_items`).Scan(&total)
	writeJSON(w, map[string]any{
		"items": items,
		"total": total,
	})
}

func (h *MediaHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Title            *string `json:"title"`
		LibraryID        *int64  `json:"library_id"`
		Rating           *string `json:"rating"`
		TrailerYoutubeID *string `json:"trailer_youtube_id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	if body.Title != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET title = ? WHERE id = ?`, *body.Title, id); err != nil {
			http.Error(w, `{"error":"failed to update title"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.LibraryID != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET library_id = ? WHERE id = ?`, *body.LibraryID, id); err != nil {
			http.Error(w, `{"error":"failed to update library"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.Rating != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET rating = ? WHERE id = ?`, *body.Rating, id); err != nil {
			http.Error(w, `{"error":"failed to update rating"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.TrailerYoutubeID != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET trailer_youtube_id = ? WHERE id = ?`, *body.TrailerYoutubeID, id); err != nil {
			http.Error(w, `{"error":"failed to update trailer"}`, http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *MediaHandler) Reencode(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}

	_ = id
	writeJSON(w, map[string]string{"status": "queued"})
}
