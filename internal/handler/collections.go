package handler

import (
	"database/sql"
	"net/http"
	"strconv"
)

type CollectionHandler struct {
	db *sql.DB
}

func NewCollectionHandler(db *sql.DB) *CollectionHandler {
	return &CollectionHandler{db: db}
}

type collectionItem struct {
	ID               int64  `json:"id"`
	Title            string `json:"title"`
	MediaType        string `json:"media_type"`
	PosterPath       string `json:"poster_path"`
	DurationSeconds  int    `json:"duration_seconds"`
}

func (h *CollectionHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`
		SELECT c.id, c.name, c.poster_path, c.backdrop_path, c.tmdb_collection_id, c.overview, c.created_at,
		       (SELECT COUNT(*) FROM collection_items WHERE collection_id = c.id) as item_count
		FROM collections c ORDER BY c.name
	`)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
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
		if err := rows.Scan(&c.ID, &c.Name, &c.PosterPath, &c.BackdropPath, &c.TmdbCollectionID, &c.Overview, &c.CreatedAt, &c.ItemCount); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		list = append(list, c)
	}
	if list == nil {
		list = []coll{}
	}
	writeJSON(w, list)
}

func (h *CollectionHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	var c struct {
		ID              int64  `json:"id"`
		Name            string `json:"name"`
		PosterPath      string `json:"poster_path"`
		BackdropPath    string `json:"backdrop_path"`
		TmdbCollectionID *int64 `json:"tmdb_collection_id"`
		Overview        string `json:"overview"`
		CreatedAt       string `json:"created_at"`
	}
	err = h.db.QueryRow(`SELECT id, name, poster_path, backdrop_path, tmdb_collection_id, overview, created_at FROM collections WHERE id = ?`, id).
		Scan(&c.ID, &c.Name, &c.PosterPath, &c.BackdropPath, &c.TmdbCollectionID, &c.Overview, &c.CreatedAt)
	if err == sql.ErrNoRows {
		writeError(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, c)
}

func (h *CollectionHandler) Items(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	rows, err := h.db.Query(`
		SELECT mi.id, mi.title, mi.media_type,
		       CASE WHEN mp.file_path IS NOT NULL THEN '' ELSE COALESCE(mi.poster_path, '') END as poster_path,
		       mi.duration_seconds
		FROM collection_items ci
		JOIN media_items mi ON mi.id = ci.media_id
		LEFT JOIN media_images mp ON mp.media_id = mi.id AND mp.image_type = 'poster' AND mp.is_primary = 1
		WHERE ci.collection_id = ?
		ORDER BY ci.sort_order, mi.title
	`, id)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var items []collectionItem
	for rows.Next() {
		var i collectionItem
		if err := rows.Scan(&i.ID, &i.Title, &i.MediaType, &i.PosterPath, &i.DurationSeconds); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		items = append(items, i)
	}
	if items == nil {
		items = []collectionItem{}
	}
	writeJSON(w, items)
}
