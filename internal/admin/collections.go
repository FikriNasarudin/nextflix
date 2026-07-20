package admin

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
)

type CollectionHandler struct {
	db *sql.DB
}

func NewCollectionHandler(db *sql.DB) *CollectionHandler {
	return &CollectionHandler{db: db}
}

func (h *CollectionHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`
		SELECT c.id, c.name, c.poster_path, c.backdrop_path, c.tmdb_collection_id, c.overview, c.created_at,
		       (SELECT COUNT(*) FROM collection_items WHERE collection_id = c.id) as item_count
		FROM collections c ORDER BY c.name
	`)
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type coll struct {
		ID              int64  `json:"id"`
		Name            string `json:"name"`
		PosterPath      string `json:"poster_path"`
		BackdropPath    string `json:"backdrop_path"`
		TmdbCollectionID *int64 `json:"tmdb_collection_id"`
		Overview        string `json:"overview"`
		ItemCount       int    `json:"item_count"`
		CreatedAt       string `json:"created_at"`
	}
	var list []coll
	for rows.Next() {
		var c coll
		rows.Scan(&c.ID, &c.Name, &c.PosterPath, &c.BackdropPath, &c.TmdbCollectionID, &c.Overview, &c.CreatedAt, &c.ItemCount)
		list = append(list, c)
	}
	if list == nil {
		list = []coll{}
	}
	writeJSON(w, list)
}

func (h *CollectionHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name            string  `json:"name"`
		PosterPath      string  `json:"poster_path"`
		BackdropPath    string  `json:"backdrop_path"`
		TmdbCollectionID *int64 `json:"tmdb_collection_id"`
		Overview        string  `json:"overview"`
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
		`INSERT INTO collections (name, poster_path, backdrop_path, tmdb_collection_id, overview) VALUES (?, ?, ?, ?, ?)`,
		body.Name, body.PosterPath, body.BackdropPath, body.TmdbCollectionID, body.Overview,
	)
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	id, _ := result.LastInsertId()
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]int64{"id": id})
}

func (h *CollectionHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Name            *string `json:"name"`
		PosterPath      *string `json:"poster_path"`
		BackdropPath    *string `json:"backdrop_path"`
		TmdbCollectionID *int64  `json:"tmdb_collection_id"`
		Overview        *string `json:"overview"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	if body.Name != nil {
		h.db.Exec(`UPDATE collections SET name = ? WHERE id = ?`, *body.Name, id)
	}
	if body.PosterPath != nil {
		h.db.Exec(`UPDATE collections SET poster_path = ? WHERE id = ?`, *body.PosterPath, id)
	}
	if body.BackdropPath != nil {
		h.db.Exec(`UPDATE collections SET backdrop_path = ? WHERE id = ?`, *body.BackdropPath, id)
	}
	if body.TmdbCollectionID != nil {
		h.db.Exec(`UPDATE collections SET tmdb_collection_id = ? WHERE id = ?`, *body.TmdbCollectionID, id)
	}
	if body.Overview != nil {
		h.db.Exec(`UPDATE collections SET overview = ? WHERE id = ?`, *body.Overview, id)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *CollectionHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	h.db.Exec(`DELETE FROM collections WHERE id = ?`, id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *CollectionHandler) SetItems(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		MediaIDs []int64 `json:"media_ids"`
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

	tx.Exec(`DELETE FROM collection_items WHERE collection_id = ?`, id)
	for i, mid := range body.MediaIDs {
		tx.Exec(`INSERT INTO collection_items (collection_id, media_id, sort_order) VALUES (?, ?, ?)`, id, mid, i)
	}
	tx.Commit()

	w.WriteHeader(http.StatusNoContent)
}
