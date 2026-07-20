package handler

import (
	"database/sql"
	"net/http"
	"path/filepath"
	"strings"

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
		SELECT mi.id, mi.library_id, mi.title, mi.media_type, mi.tmdb_id, mi.rating,
		       mi.duration_seconds, mi.trailer_youtube_id, mi.backdrop_path, mi.poster_path,
		       mi.show_name, mi.season_number, mi.episode_number, mi.episode_title, mi.year, mi.overview,
		       COALESCE(mi.hls_480p_path, '') as hls_480p_path,
		       mi.file_path,
		COALESCE((SELECT GROUP_CONCAT(t.name, '||') FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = mi.id), '') as tags,
		       mi.created_at
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
		ID               int64    `json:"id"`
		LibraryID        *int64   `json:"library_id"`
		Title            string   `json:"title"`
		MediaType        string   `json:"media_type"`
		TmdbID           *int64   `json:"tmdb_id"`
		Rating           string   `json:"rating"`
		DurationSeconds  int      `json:"duration_seconds"`
		TrailerYoutubeID string   `json:"trailer_youtube_id"`
		BackdropPath     string   `json:"backdrop_path"`
		PosterPath       string   `json:"poster_path"`
		ShowName         string   `json:"show_name"`
		SeasonNumber     int      `json:"season_number"`
		EpisodeNumber    int      `json:"episode_number"`
		EpisodeTitle     string   `json:"episode_title"`
		Year             string   `json:"year"`
		Overview         string   `json:"overview"`
		HLS480pPath      string   `json:"hls_path"`
		Container        string   `json:"container"`
		Tags             []string `json:"tags"`
		CreatedAt        string   `json:"created_at"`
	}

	var items []mediaItem
	for rows.Next() {
		var i mediaItem
		var filePath, tagsStr string
		rows.Scan(
			&i.ID, &i.LibraryID, &i.Title, &i.MediaType, &i.TmdbID, &i.Rating,
			&i.DurationSeconds, &i.TrailerYoutubeID, &i.BackdropPath, &i.PosterPath,
			&i.ShowName, &i.SeasonNumber, &i.EpisodeNumber, &i.EpisodeTitle, &i.Year, &i.Overview,
			&i.HLS480pPath, &filePath, &tagsStr, &i.CreatedAt,
		)
		i.Container = strings.TrimPrefix(filepath.Ext(filePath), ".")
		if tagsStr != "" {
			i.Tags = strings.Split(tagsStr, "||")
		} else {
			i.Tags = []string{}
		}
		items = append(items, i)
	}
	if items == nil {
		items = []mediaItem{}
	}

	writeJSON(w, items)
}
