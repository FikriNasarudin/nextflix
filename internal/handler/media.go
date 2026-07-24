package handler

import (
	"database/sql"
	"net/http"
	"path/filepath"
	"strconv"
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

	limit := 50
	offset := 0
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 && l <= 500 {
		limit = l
	}
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		offset = o
	}

	var query string
	var args []any

	query = `
		SELECT mi.id, mi.library_id, mi.title, mi.media_type, mi.tmdb_id, mi.rating,
		       mi.duration_seconds, mi.trailer_youtube_id,
		       MAX(COALESCE(mi.backdrop_path, mb.file_path, '')) as backdrop_path,
		MAX(CASE WHEN mp.file_path IS NOT NULL THEN '' WHEN si.file_path IS NOT NULL THEN '' ELSE COALESCE(mi.poster_path, '') END) as poster_path,
		       mi.show_name, mi.season_number, mi.episode_number, mi.episode_title, mi.year, mi.overview,
		       mi.file_path,
		COALESCE((SELECT GROUP_CONCAT(t.name, '||') FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = mi.id), '') as tags,
		       mi.created_at,
		       MAX(COALESCE(v.codec, '')) as video_codec,
		       MAX(COALESCE(v.width, 0)) as width,
		       MAX(COALESCE(v.height, 0)) as height,
		       MAX(COALESCE(v.is_hdr, 0)) as is_hdr,
		       COALESCE(a.codec, '') as audio_codec,
		       COALESCE(a.channels, 0) as audio_channels
		FROM media_items mi
		LEFT JOIN media_images mb ON mb.media_id = mi.id AND mb.image_type = 'backdrop' AND mb.is_primary = 1
		LEFT JOIN media_images mp ON mp.media_id = mi.id AND mp.image_type = 'poster' AND mp.is_primary = 1
		LEFT JOIN show_images si ON si.show_name = mi.show_name AND si.image_type = 'poster' AND si.season_number = 0
		LEFT JOIN media_video_tracks v ON v.media_id = mi.id AND v.is_default = 1
		LEFT JOIN media_audio_tracks a ON a.media_id = mi.id AND a.is_default = 1
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

	if mediaType := r.URL.Query().Get("media_type"); mediaType != "" {
		query += ` AND mi.media_type = ?`
		args = append(args, mediaType)
	}

	query += ` GROUP BY mi.id`
	query += ` ORDER BY mi.created_at DESC`
	args = append(args, limit, offset)
	query += ` LIMIT ? OFFSET ?`

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
		Container        string   `json:"container"`
		VideoCodec       string   `json:"video_codec"`
		Width            int      `json:"width"`
		Height           int      `json:"height"`
		IsHDR            bool     `json:"is_hdr"`
		AudioCodec       string   `json:"audio_codec"`
		AudioChannels    int      `json:"audio_channels"`
		Tags             []string `json:"tags"`
		CreatedAt        string   `json:"created_at"`
	}

	var items []mediaItem
	for rows.Next() {
		var i mediaItem
		var filePath, tagsStr string
		if err := rows.Scan(
			&i.ID, &i.LibraryID, &i.Title, &i.MediaType, &i.TmdbID, &i.Rating,
			&i.DurationSeconds, &i.TrailerYoutubeID, &i.BackdropPath, &i.PosterPath,
			&i.ShowName, &i.SeasonNumber, &i.EpisodeNumber, &i.EpisodeTitle, &i.Year, &i.Overview,
			&filePath, &tagsStr, &i.CreatedAt,
			&i.VideoCodec, &i.Width, &i.Height, &i.IsHDR,
			&i.AudioCodec, &i.AudioChannels,
		); err != nil {
			http.Error(w, `{"error":"scan error"}`, http.StatusInternalServerError)
			return
		}
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

	var total int
	countQuery := `SELECT COUNT(*) FROM media_items mi WHERE 1=1`
	countArgs := []any{}
	if hasLibraryRestriction {
		countQuery += ` AND mi.library_id IN (SELECT library_id FROM profile_library_access WHERE profile_id = ?)`
		countArgs = append(countArgs, profileID)
	}
	if maxRating != "" {
		countQuery += ` AND (mi.rating = '' OR mi.rating <= ?)`
		countArgs = append(countArgs, maxRating)
	}
	h.db.QueryRow(countQuery, countArgs...).Scan(&total)

	writeJSON(w, map[string]any{
		"items": items,
		"total": total,
	})
}
