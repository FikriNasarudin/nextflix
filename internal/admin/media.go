package admin

import (
	"database/sql"
	"net/http"
	"strconv"

	"nextflix/internal/encoder"
)

type MediaHandler struct {
	db  *sql.DB
	enc *encoder.Encoder
}

func NewMediaHandler(db *sql.DB, enc *encoder.Encoder) *MediaHandler {
	return &MediaHandler{db: db, enc: enc}
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
		SELECT m.id, m.library_id, m.title, m.media_type, m.tmdb_id, m.rating,
		       m.duration_seconds, m.trailer_youtube_id, m.backdrop_path, m.poster_path, m.created_at,
		       COALESCE(m.hls_480p_path, ''),
		       COALESCE(v.width, 0), COALESCE(v.height, 0), COALESCE(v.codec, ''),
		       COALESCE(s.count, 0), COALESCE(a.count, 0),
		       COALESCE(j.queued, 0), COALESCE(j.inprogress, 0), COALESCE(j.failed, 0)
		FROM media_items m
		LEFT JOIN media_video_tracks v ON v.media_id = m.id AND v.is_default = 1
		LEFT JOIN (SELECT media_id, COUNT(*) AS count FROM media_subtitles GROUP BY media_id) s ON s.media_id = m.id
		LEFT JOIN (SELECT media_id, COUNT(*) AS count FROM media_audio_tracks GROUP BY media_id) a ON a.media_id = m.id
		LEFT JOIN (
			SELECT media_id,
				SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
				SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS inprogress,
				SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
			FROM encode_jobs GROUP BY media_id
		) j ON j.media_id = m.id
		ORDER BY m.created_at DESC
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
		HlsPath          string  `json:"hls_path"`
		IsOptimized      bool    `json:"is_optimized"`
		OptimStatus      string  `json:"optim_status"`
		Width            int     `json:"width"`
		Height           int     `json:"height"`
		VideoCodec       string  `json:"video_codec"`
		SubtitleCount    int     `json:"subtitle_count"`
		AudioCount       int     `json:"audio_count"`
	}
	var items []item
	for rows.Next() {
		var i item
		var hlsPath string
		var queued, inprogress, failed int
		if err := rows.Scan(
			&i.ID, &i.LibraryID, &i.Title, &i.MediaType, &i.TmdbID, &i.Rating,
			&i.DurationSeconds, &i.TrailerYoutubeID, &i.BackdropPath, &i.PosterPath, &i.CreatedAt,
			&hlsPath, &i.Width, &i.Height, &i.VideoCodec, &i.SubtitleCount, &i.AudioCount,
			&queued, &inprogress, &failed,
		); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		i.HlsPath = hlsPath
		i.IsOptimized = hlsPath != ""
		if i.IsOptimized {
			i.OptimStatus = "completed"
		} else if failed > 0 {
			i.OptimStatus = "failed"
		} else if inprogress > 0 {
			i.OptimStatus = "in_progress"
		} else if queued > 0 {
			i.OptimStatus = "queued"
		} else {
			i.OptimStatus = "pending"
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
	var duration int
	if err := h.db.QueryRow(`SELECT file_path, duration_seconds FROM media_items WHERE id = ?`, id).Scan(&filePath, &duration); err != nil {
		if err == sql.ErrNoRows {
			writeError(w, "not found", http.StatusNotFound)
		} else {
			writeError(w, "database error", http.StatusInternalServerError)
		}
		return
	}

	if h.enc == nil {
		writeError(w, "encoder unavailable", http.StatusServiceUnavailable)
		return
	}

	if err := h.enc.Reenqueue(id, filePath, int64(duration)); err != nil {
		writeJSON(w, map[string]string{"status": "queue_full", "error": err.Error()})
		return
	}
	h.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('encode', ?)`, "Re-encode triggered for media "+strconv.FormatInt(id, 10))
	writeJSON(w, map[string]string{"status": "queued"})
}