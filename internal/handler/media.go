package handler

import (
	"database/sql"
	"net/http"

	"nextflix/internal/middleware"
)

type MediaHandler struct {
	db *sql.DB
}

func NewMediaHandler(db *sql.DB) *MediaHandler {
	return &MediaHandler{db: db}
}

func (h *MediaHandler) List(w http.ResponseWriter, r *http.Request) {
	profileID := middleware.ProfileIDFromContext(r.Context())

	var query string
	var args []any

	query = `
		SELECT id, library_id, title, media_type, tmdb_id, rating,
		       duration_seconds, trailer_youtube_id, backdrop_path, poster_path,
		       show_name, season_number, episode_number, episode_title, year, created_at
		FROM media_items mi
		WHERE 1=1
	`

	hasLibraryRestriction := false
	err := h.db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM profile_library_access WHERE profile_id = ?)`, profileID,
	).Scan(&hasLibraryRestriction)
	if err == nil && hasLibraryRestriction {
		query += ` AND mi.library_id IN (SELECT library_id FROM profile_library_access WHERE profile_id = ?)`
		args = append(args, profileID)
	}

	var maxRating string
	h.db.QueryRow(`SELECT max_rating FROM profiles WHERE id = ?`, profileID).Scan(&maxRating)
	if maxRating != "" {
		query += ` AND (mi.rating = '' OR mi.rating <= ?)`
		args = append(args, maxRating)
	}

	query += ` ORDER BY mi.created_at DESC`

	rows, err := h.db.Query(query, args...)
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type mediaItem struct {
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
		ShowName         string  `json:"show_name"`
		SeasonNumber     int     `json:"season_number"`
		EpisodeNumber    int     `json:"episode_number"`
		EpisodeTitle     string  `json:"episode_title"`
		Year             string  `json:"year"`
		CreatedAt        string  `json:"created_at"`
	}

	var items []mediaItem
	for rows.Next() {
		var i mediaItem
		rows.Scan(
			&i.ID, &i.LibraryID, &i.Title, &i.MediaType, &i.TmdbID, &i.Rating,
			&i.DurationSeconds, &i.TrailerYoutubeID, &i.BackdropPath, &i.PosterPath,
			&i.ShowName, &i.SeasonNumber, &i.EpisodeNumber, &i.EpisodeTitle, &i.Year, &i.CreatedAt,
		)
		items = append(items, i)
	}
	if items == nil {
		items = []mediaItem{}
	}

	writeJSON(w, items)
}
