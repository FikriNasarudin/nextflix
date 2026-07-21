package admin

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
)

type TagHandler struct {
	db *sql.DB
}

func NewTagHandler(db *sql.DB) *TagHandler {
	return &TagHandler{db: db}
}

func (h *TagHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT id, name, tmdb_genre_id FROM tags ORDER BY id`)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type tag struct {
		ID          int64  `json:"id"`
		Name        string `json:"name"`
		TmdbGenreID *int64 `json:"tmdb_genre_id"`
	}
	var tags []tag
	for rows.Next() {
		var t tag
		if err := rows.Scan(&t.ID, &t.Name, &t.TmdbGenreID); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		tags = append(tags, t)
	}
	if err := rows.Err(); err != nil {
		writeError(w, "rows error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, emptySlice(tags))
}

func (h *TagHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		TmdbGenreID *int64 `json:"tmdb_genre_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, "invalid request", http.StatusBadRequest)
		return
	}
	if body.Name == "" {
		writeError(w, "name required", http.StatusBadRequest)
		return
	}

	result, err := h.db.Exec(
		`INSERT INTO tags (name, tmdb_genre_id) VALUES (?, ?)`,
		body.Name, body.TmdbGenreID,
	)
	if err != nil {
		writeError(w, "tag already exists", http.StatusConflict)
		return
	}
	id, _ := result.LastInsertId()
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]int64{"id": id})
}

func (h *TagHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	var body struct {
		Name        *string `json:"name"`
		TmdbGenreID *int64  `json:"tmdb_genre_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, "invalid request", http.StatusBadRequest)
		return
	}

	if body.Name != nil {
		if _, err := h.db.Exec(`UPDATE tags SET name = ? WHERE id = ?`, *body.Name, id); err != nil {
			writeError(w, "failed to update tag", http.StatusInternalServerError)
			return
		}
	}
	if body.TmdbGenreID != nil {
		if _, err := h.db.Exec(`UPDATE tags SET tmdb_genre_id = ? WHERE id = ?`, *body.TmdbGenreID, id); err != nil {
			writeError(w, "failed to update tmdb_genre_id", http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *TagHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	var exists int
	h.db.QueryRow(`SELECT COUNT(*) FROM tags WHERE id = ?`, id).Scan(&exists)
	if exists == 0 {
		writeError(w, "not found", http.StatusNotFound)
		return
	}

	h.db.Exec(`DELETE FROM media_tags WHERE tag_id = ?`, id)
	if _, err := h.db.Exec(`DELETE FROM tags WHERE id = ?`, id); err != nil {
		writeError(w, "failed to delete tag", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *TagHandler) ListMediaTags(w http.ResponseWriter, r *http.Request) {
	mid, err := strconv.ParseInt(r.PathValue("mid"), 10, 64)
	if err != nil {
		writeError(w, "invalid media id", http.StatusBadRequest)
		return
	}

	rows, err := h.db.Query(
		`SELECT t.id, t.name FROM tags t JOIN media_tags mt ON mt.tag_id = t.id WHERE mt.media_id = ? ORDER BY t.id`,
		mid,
	)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type tag struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	var tags []tag
	for rows.Next() {
		var t tag
		if err := rows.Scan(&t.ID, &t.Name); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		tags = append(tags, t)
	}
	if err := rows.Err(); err != nil {
		writeError(w, "rows error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, emptySlice(tags))
}

func (h *TagHandler) SetMediaTags(w http.ResponseWriter, r *http.Request) {
	mid, err := strconv.ParseInt(r.PathValue("mid"), 10, 64)
	if err != nil {
		writeError(w, "invalid media id", http.StatusBadRequest)
		return
	}

	var body struct {
		TagIDs []int64 `json:"tag_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, "invalid request", http.StatusBadRequest)
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM media_tags WHERE media_id = ?`, mid); err != nil {
		writeError(w, "failed to clear tags", http.StatusInternalServerError)
		return
	}
	for _, tid := range body.TagIDs {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)`, mid, tid); err != nil {
			writeError(w, "failed to insert tag", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, "failed to commit", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
