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
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
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
		rows.Scan(&t.ID, &t.Name, &t.TmdbGenreID)
		tags = append(tags, t)
	}
	writeJSON(w, tags)
}

func (h *TagHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		TmdbGenreID *int64 `json:"tmdb_genre_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	if body.Name == "" {
		http.Error(w, `{"error":"name required"}`, http.StatusBadRequest)
		return
	}

	result, err := h.db.Exec(
		`INSERT INTO tags (name, tmdb_genre_id) VALUES (?, ?)`,
		body.Name, body.TmdbGenreID,
	)
	if err != nil {
		http.Error(w, `{"error":"tag already exists"}`, http.StatusConflict)
		return
	}
	id, _ := result.LastInsertId()
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]int64{"id": id})
}

func (h *TagHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Name *string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	if body.Name != nil {
		h.db.Exec(`UPDATE tags SET name = ? WHERE id = ?`, *body.Name, id)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *TagHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	h.db.Exec(`DELETE FROM tags WHERE id = ?`, id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *TagHandler) ListMediaTags(w http.ResponseWriter, r *http.Request) {
	mid, err := strconv.ParseInt(r.PathValue("mid"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid media id"}`, http.StatusBadRequest)
		return
	}

	rows, err := h.db.Query(
		`SELECT t.id, t.name FROM tags t JOIN media_tags mt ON mt.tag_id = t.id WHERE mt.media_id = ? ORDER BY t.id`,
		mid,
	)
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
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
		rows.Scan(&t.ID, &t.Name)
		tags = append(tags, t)
	}
	writeJSON(w, tags)
}

func (h *TagHandler) SetMediaTags(w http.ResponseWriter, r *http.Request) {
	mid, err := strconv.ParseInt(r.PathValue("mid"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid media id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		TagIDs []int64 `json:"tag_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}

	tx.Exec(`DELETE FROM media_tags WHERE media_id = ?`, mid)
	for _, tid := range body.TagIDs {
		tx.Exec(`INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)`, mid, tid)
	}
	tx.Commit()

	w.WriteHeader(http.StatusNoContent)
}
