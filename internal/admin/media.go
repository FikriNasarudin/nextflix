package admin

import (
	"database/sql"
	"log"
	"net/http"
	"strconv"
	"strings"

	"nextflix/internal/library"
)

type MediaHandler struct {
	db *sql.DB
	lm *library.LibraryManager
}

func NewMediaHandler(db *sql.DB, lm *library.LibraryManager) *MediaHandler {
	return &MediaHandler{db: db, lm: lm}
}

func (h *MediaHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	limit := 50
	if l, err := strconv.Atoi(q.Get("limit")); err == nil && l > 0 && l <= 500 {
		limit = l
	}
	offset := 0
	if o, err := strconv.Atoi(q.Get("offset")); err == nil && o >= 0 {
		offset = o
	}

	var wheres []string
	var args []any

	if sq := strings.TrimSpace(q.Get("q")); sq != "" {
		wheres = append(wheres, "m.title LIKE ?")
		args = append(args, "%"+sq+"%")
	}
	if lt := q.Get("library_id"); lt != "" {
		if id, err := strconv.ParseInt(lt, 10, 64); err == nil {
			wheres = append(wheres, "m.library_id = ?")
			args = append(args, id)
		}
	}
	if mt := q.Get("media_type"); mt != "" {
		wheres = append(wheres, "m.media_type = ?")
		args = append(args, mt)
	}
	switch q.Get("enrichment") {
	case "ok":
		wheres = append(wheres, "m.enrich_status = 'ok'")
	case "missing":
		wheres = append(wheres, "(m.tmdb_id IS NULL OR m.tmdb_id = 0)")
	case "failed":
		wheres = append(wheres, "m.enrich_status = 'failed'")
	case "pending":
		wheres = append(wheres, "m.enrich_status = 'pending'")
	}

	whereClause := ""
	if len(wheres) > 0 {
		whereClause = "WHERE " + strings.Join(wheres, " AND ")
	}

	var total int
	countSQL := "SELECT COUNT(*) FROM media_items m " + whereClause
	h.db.QueryRow(countSQL, args...).Scan(&total)
	w.Header().Set("X-Total-Count", strconv.Itoa(total))

	sqlArgs := append(args, limit, offset)
	rows, err := h.db.Query(`
		SELECT m.id, m.library_id, m.title, m.media_type, m.tmdb_id, m.rating,
		       m.duration_seconds, m.trailer_youtube_id, m.backdrop_path, m.poster_path, m.created_at,
		       COALESCE(v.width, 0), COALESCE(v.height, 0), COALESCE(v.codec, ''),
		       COALESCE(s.count, 0), COALESCE(a.count, 0),
		       COALESCE(m.overview, ''), COALESCE(m.year, ''), COALESCE(m.show_name, ''), COALESCE(m.season_number, 0), COALESCE(m.episode_number, 0), COALESCE(m.episode_title, ''),
		       COALESCE(m.enrich_status, 'pending'), COALESCE(m.enrich_error, ''), COALESCE(m.last_enriched_at, '')
		FROM media_items m
		LEFT JOIN (SELECT media_id, codec, width, height, is_default FROM media_video_tracks WHERE is_default = 1 GROUP BY media_id) v ON v.media_id = m.id
		LEFT JOIN (SELECT media_id, COUNT(*) AS count FROM media_subtitles GROUP BY media_id) s ON s.media_id = m.id
		LEFT JOIN (SELECT media_id, COUNT(*) AS count FROM media_audio_tracks GROUP BY media_id) a ON a.media_id = m.id
		`+whereClause+`
		ORDER BY m.created_at DESC
		LIMIT ? OFFSET ?
	`, sqlArgs...)
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
		Width            int     `json:"width"`
		Height           int     `json:"height"`
		VideoCodec       string  `json:"video_codec"`
		SubtitleCount    int     `json:"subtitle_count"`
		AudioCount       int     `json:"audio_count"`
		Overview         string  `json:"overview"`
		Year             string  `json:"year"`
		ShowName         string  `json:"show_name"`
		SeasonNumber     int     `json:"season_number"`
		EpisodeNumber    int     `json:"episode_number"`
		EpisodeTitle     string  `json:"episode_title"`
		EnrichStatus     string  `json:"enrich_status"`
		EnrichError      string  `json:"enrich_error"`
		LastEnrichedAt   string  `json:"last_enriched_at"`
	}
	var items []item
	for rows.Next() {
		var i item
		if err := rows.Scan(
			&i.ID, &i.LibraryID, &i.Title, &i.MediaType, &i.TmdbID, &i.Rating,
			&i.DurationSeconds, &i.TrailerYoutubeID, &i.BackdropPath, &i.PosterPath, &i.CreatedAt,
			&i.Width, &i.Height, &i.VideoCodec, &i.SubtitleCount, &i.AudioCount,
			&i.Overview, &i.Year, &i.ShowName, &i.SeasonNumber, &i.EpisodeNumber, &i.EpisodeTitle,
			&i.EnrichStatus, &i.EnrichError, &i.LastEnrichedAt,
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

func (h *MediaHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	var i struct {
		ID               int64
		LibraryID        *int64
		Title            string
		MediaType        string
		TmdbID           *int64
		Rating           string
		DurationSeconds  int
		TrailerYoutubeID string
		BackdropPath     string
		PosterPath       string
		CreatedAt        string
		Overview         string
		Year             string
		ShowName         string
		SeasonNumber     int
		EpisodeNumber    int
		EpisodeTitle     string
		EnrichStatus     string
		EnrichError      string
		LastEnrichedAt   string
	}
	err = h.db.QueryRow(`
		SELECT id, library_id, title, media_type, tmdb_id, rating, duration_seconds,
		       trailer_youtube_id, backdrop_path, poster_path, created_at,
		       COALESCE(overview, ''), COALESCE(year, ''), COALESCE(show_name, ''), COALESCE(season_number, 0), COALESCE(episode_number, 0), COALESCE(episode_title, ''),
		       COALESCE(enrich_status, 'pending'), COALESCE(enrich_error, ''), COALESCE(last_enriched_at, '')
		FROM media_items WHERE id = ?
	`, id).Scan(
		&i.ID, &i.LibraryID, &i.Title, &i.MediaType, &i.TmdbID, &i.Rating, &i.DurationSeconds,
		&i.TrailerYoutubeID, &i.BackdropPath, &i.PosterPath, &i.CreatedAt,
		&i.Overview, &i.Year, &i.ShowName, &i.SeasonNumber, &i.EpisodeNumber, &i.EpisodeTitle,
		&i.EnrichStatus, &i.EnrichError, &i.LastEnrichedAt,
	)
	if err == sql.ErrNoRows {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, i)
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
		Overview         *string `json:"overview"`
		Year             *string `json:"year"`
		TmdbID           *int64  `json:"tmdb_id"`
		PosterPath       *string `json:"poster_path"`
		BackdropPath     *string `json:"backdrop_path"`
		ShowName         *string `json:"show_name"`
		SeasonNumber     *int    `json:"season_number"`
		EpisodeNumber    *int    `json:"episode_number"`
		EpisodeTitle     *string `json:"episode_title"`
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
	if body.Overview != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET overview = ? WHERE id = ?`, *body.Overview, id); err != nil {
			writeError(w, "failed to update overview", http.StatusInternalServerError)
			return
		}
	}
	if body.Year != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET year = ? WHERE id = ?`, *body.Year, id); err != nil {
			writeError(w, "failed to update year", http.StatusInternalServerError)
			return
		}
	}
	if body.TmdbID != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET tmdb_id = ?, enrich_status='pending' WHERE id = ?`, *body.TmdbID, id); err != nil {
			writeError(w, "failed to update tmdb_id", http.StatusInternalServerError)
			return
		}
	}
	if body.PosterPath != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET poster_path = ? WHERE id = ?`, *body.PosterPath, id); err != nil {
			writeError(w, "failed to update poster", http.StatusInternalServerError)
			return
		}
	}
	if body.BackdropPath != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET backdrop_path = ? WHERE id = ?`, *body.BackdropPath, id); err != nil {
			writeError(w, "failed to update backdrop", http.StatusInternalServerError)
			return
		}
	}
	if body.ShowName != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET show_name = ? WHERE id = ?`, *body.ShowName, id); err != nil {
			writeError(w, "failed to update show_name", http.StatusInternalServerError)
			return
		}
	}
	if body.SeasonNumber != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET season_number = ? WHERE id = ?`, *body.SeasonNumber, id); err != nil {
			writeError(w, "failed to update season_number", http.StatusInternalServerError)
			return
		}
	}
	if body.EpisodeNumber != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET episode_number = ? WHERE id = ?`, *body.EpisodeNumber, id); err != nil {
			writeError(w, "failed to update episode_number", http.StatusInternalServerError)
			return
		}
	}
	if body.EpisodeTitle != nil {
		if _, err := h.db.Exec(`UPDATE media_items SET episode_title = ? WHERE id = ?`, *body.EpisodeTitle, id); err != nil {
			writeError(w, "failed to update episode_title", http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *MediaHandler) RefreshMetadata(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	if h.lm == nil {
		writeError(w, "metadata refresh unavailable", http.StatusServiceUnavailable)
		return
	}

	if err := h.lm.RefreshItem(id); err != nil {
		log.Printf("admin: refresh metadata for %d: %v", id, err)
		writeJSON(w, map[string]string{"status": "failed", "error": err.Error()})
		return
	}

	h.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('metadata', ?)`, "Metadata refreshed for media #"+strconv.FormatInt(id, 10))
	writeJSON(w, map[string]string{"status": "ok"})
}


