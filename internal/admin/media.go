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
		writeError(w, "database error", http.StatusInternalServerError)
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
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		items = append(items, i)
	}
	if err := rows.Err(); err != nil {
		writeError(w, "rows error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, emptySlice(items))
}

func (h *MediaHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	var body struct {
		Title            *string `json:"title"`
		LibraryID        *int64  `json:"library_id"`
		Rating           *string `json:"rating"`
		TrailerYoutubeID *string `json:"trailer_youtube_id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, "invalid request", http.StatusBadRequest)
		return
	}

	if body.Title != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET title = ? WHERE id = ?`, *body.Title, id); err != nil {
			writeError(w, "failed to update title", http.StatusInternalServerError)
			return
		}
	}
	if body.LibraryID != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET library_id = ? WHERE id = ?`, *body.LibraryID, id); err != nil {
			writeError(w, "failed to update library", http.StatusInternalServerError)
			return
		}
	}
	if body.Rating != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET rating = ? WHERE id = ?`, *body.Rating, id); err != nil {
			writeError(w, "failed to update rating", http.StatusInternalServerError)
			return
		}
	}
	if body.TrailerYoutubeID != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET trailer_youtube_id = ? WHERE id = ?`, *body.TrailerYoutubeID, id); err != nil {
			writeError(w, "failed to update trailer", http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *MediaHandler) Reencode(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	var filePath string
	if err := h.db.QueryRow(`SELECT file_path FROM media_items WHERE id = ?`, id).Scan(&filePath); err != nil {
		if err == sql.ErrNoRows {
			writeError(w, "not found", http.StatusNotFound)
		} else {
			writeError(w, "database error", http.StatusInternalServerError)
		}
		return
	}

	var hlsPath string
	h.db.QueryRow(`SELECT COALESCE(hls_480p_path, '') FROM media_items WHERE id = ?`, id).Scan(&hlsPath)
	if hlsPath != "" {
		writeJSON(w, map[string]string{"status": "already encoded"})
		return
	}

	h.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('encode', 'Re-encoding media ' || ?)`, filePath)
	writeJSON(w, map[string]string{"status": "queued"})
}
