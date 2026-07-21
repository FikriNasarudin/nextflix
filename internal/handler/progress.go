package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"nextflix/internal/middleware"
)

type ProgressHandler struct {
	db *sql.DB
}

func NewProgressHandler(db *sql.DB) *ProgressHandler {
	return &ProgressHandler{db: db}
}

func (h *ProgressHandler) List(w http.ResponseWriter, r *http.Request) {
	profileID := middleware.ProfileIDFromContext(r.Context())

	rows, err := h.db.Query(`
		SELECT pp.media_id, pp.position_seconds, pp.is_finished, pp.updated_at,
		       mi.title, mi.duration_seconds,
		       CASE WHEN mp.file_path IS NOT NULL THEN '' ELSE COALESCE(mi.poster_path, '') END as poster_path
		FROM playback_progress pp
		JOIN media_items mi ON mi.id = pp.media_id
		LEFT JOIN media_images mp ON mp.media_id = mi.id AND mp.image_type = 'poster' AND mp.is_primary = 1
		WHERE pp.profile_id = ?
		ORDER BY pp.updated_at DESC
	`, profileID)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type progressItem struct {
		MediaID        int64  `json:"media_id"`
		PositionSec    int    `json:"position_seconds"`
		IsFinished     bool   `json:"is_finished"`
		UpdatedAt      string `json:"updated_at"`
		Title          string `json:"title"`
		DurationSec    int    `json:"duration_seconds"`
		PosterPath     string `json:"poster_path"`
	}

	var items []progressItem
	for rows.Next() {
		var i progressItem
		if err := rows.Scan(&i.MediaID, &i.PositionSec, &i.IsFinished, &i.UpdatedAt,
			&i.Title, &i.DurationSec, &i.PosterPath); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		items = append(items, i)
	}
	if items == nil {
		items = []progressItem{}
	}
	writeJSON(w, items)
}

func (h *ProgressHandler) Update(w http.ResponseWriter, r *http.Request) {
	profileID := middleware.ProfileIDFromContext(r.Context())

	var body struct {
		MediaID     int64 `json:"media_id"`
		PositionSec int   `json:"position_seconds"`
		DurationSec int   `json:"duration_seconds"`
		IsFinished  bool  `json:"is_finished"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, "invalid request", http.StatusBadRequest)
		return
	}

	now := time.Now().UTC().Format("2006-01-02T15:04:05Z")

	_, err := h.db.Exec(`
		INSERT INTO playback_progress (profile_id, media_id, position_seconds, is_finished, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(profile_id, media_id) DO UPDATE SET
			position_seconds = excluded.position_seconds,
			is_finished = excluded.is_finished,
			updated_at = excluded.updated_at
	`, profileID, body.MediaID, body.PositionSec, body.IsFinished, now)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}

	if body.IsFinished {
		h.db.Exec(`
			INSERT INTO watch_history (profile_id, media_id, watched_seconds, duration_seconds, is_completed, watched_at)
			VALUES (?, ?, ?, ?, 1, ?)
		`, profileID, body.MediaID, body.PositionSec, body.DurationSec, now)
	}

	w.WriteHeader(http.StatusNoContent)
}
