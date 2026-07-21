package handler

import (
	"database/sql"
	"log"
	"net/http"

	"nextflix/internal/middleware"
)

type RecommendationHandler struct {
	db *sql.DB
}

func NewRecommendationHandler(db *sql.DB) *RecommendationHandler {
	return &RecommendationHandler{db: db}
}

func (h *RecommendationHandler) List(w http.ResponseWriter, r *http.Request) {
	profileID := middleware.ProfileIDFromContext(r.Context())

	result := map[string]any{}

	continueWatching := h.getContinueWatching(profileID)
	result["continue_watching"] = continueWatching

	becauseYouWatched := h.getCached("because_you_watched", profileID)
	result["because_you_watched"] = becauseYouWatched

	trending := h.getCached("trending", profileID)
	result["trending"] = trending

	writeJSON(w, result)
}

func (h *RecommendationHandler) getContinueWatching(profileID int64) []any {
	rows, err := h.db.Query(`
		SELECT pp.media_id, mi.title,
		       CASE WHEN mp.file_path IS NOT NULL THEN '' WHEN si.file_path IS NOT NULL THEN '' ELSE COALESCE(mi.poster_path, '') END as poster_path,
		       pp.position_seconds, mi.duration_seconds,
		       COALESCE(mi.backdrop_path, mb.file_path, '') as backdrop_path
		FROM playback_progress pp
		JOIN media_items mi ON mi.id = pp.media_id
		LEFT JOIN media_images mp ON mp.media_id = mi.id AND mp.image_type = 'poster' AND mp.is_primary = 1
		LEFT JOIN media_images mb ON mb.media_id = mi.id AND mb.image_type = 'backdrop' AND mb.is_primary = 1
		LEFT JOIN show_images si ON si.show_name = mi.show_name AND si.image_type = 'poster' AND si.season_number = 0
		WHERE pp.profile_id = ? AND pp.is_finished = 0
		ORDER BY pp.updated_at DESC
		LIMIT 20
	`, profileID)
	if err != nil {
		return []any{}
	}
	defer rows.Close()

	var items []any
	for rows.Next() {
		var mediaID int64
		var title, posterPath, backdropPath string
		var posSec, durSec int
		if err := rows.Scan(&mediaID, &title, &posterPath, &posSec, &durSec, &backdropPath); err != nil {
			log.Printf("Recommendation: scan error: %v", err)
			continue
		}
		items = append(items, map[string]any{
			"media_id":         mediaID,
			"title":            title,
			"poster_path":      posterPath,
			"backdrop_path":    backdropPath,
			"position_seconds": posSec,
			"duration_seconds": durSec,
		})
	}
	if items == nil {
		items = []any{}
	}
	return items
}

func (h *RecommendationHandler) getCached(section string, profileID int64) []any {
	rows, err := h.db.Query(`
		SELECT pr.media_id, mi.title,
		       CASE WHEN mp.file_path IS NOT NULL THEN '' WHEN si.file_path IS NOT NULL THEN '' ELSE COALESCE(mi.poster_path, '') END as poster_path,
		       COALESCE(mi.backdrop_path, mb.file_path, '') as backdrop_path,
		       pr.score, mi.duration_seconds
		FROM profile_recommendations pr
		JOIN media_items mi ON mi.id = pr.media_id
		LEFT JOIN media_images mp ON mp.media_id = mi.id AND mp.image_type = 'poster' AND mp.is_primary = 1
		LEFT JOIN media_images mb ON mb.media_id = mi.id AND mb.image_type = 'backdrop' AND mb.is_primary = 1
		LEFT JOIN show_images si ON si.show_name = mi.show_name AND si.image_type = 'poster' AND si.season_number = 0
		WHERE pr.profile_id = ? AND pr.section = ?
		ORDER BY pr.score DESC
		LIMIT 20
	`, profileID, section)
	if err != nil {
		return []any{}
	}
	defer rows.Close()

	var items []any
	for rows.Next() {
		var mediaID int64
		var title, posterPath, backdropPath string
		var score float64
		var durSec int
		if err := rows.Scan(&mediaID, &title, &posterPath, &backdropPath, &score, &durSec); err != nil {
			log.Printf("Recommendation: scan error: %v", err)
			continue
		}
		items = append(items, map[string]any{
			"media_id":         mediaID,
			"title":            title,
			"poster_path":      posterPath,
			"backdrop_path":    backdropPath,
			"score":            score,
			"duration_seconds": durSec,
		})
	}
	if items == nil {
		items = []any{}
	}
	return items
}
