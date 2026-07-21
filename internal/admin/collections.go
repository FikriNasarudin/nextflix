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
	if err := rows.Err(); err != nil {
		writeError(w, "rows error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, emptySlice(list))
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
		writeError(w, "invalid request", http.StatusBadRequest)
		return
	}
	if body.Name == "" {
		writeError(w, "name required", http.StatusBadRequest)
		return
	}

	result, err := h.db.Exec(
		`INSERT INTO collections (name, poster_path, backdrop_path, tmdb_collection_id, overview) VALUES (?, ?, ?, ?, ?)`,
		body.Name, body.PosterPath, body.BackdropPath, body.TmdbCollectionID, body.Overview,
	)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	id, _ := result.LastInsertId()
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]int64{"id": id})
}

func (h *CollectionHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
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
		writeError(w, "invalid request", http.StatusBadRequest)
		return
	}

	if body.Name != nil {
		if _, err := h.db.Exec(`UPDATE collections SET name = ? WHERE id = ?`, *body.Name, id); err != nil {
			writeError(w, "failed to update name", http.StatusInternalServerError)
			return
		}
	}
	if body.PosterPath != nil {
		if _, err := h.db.Exec(`UPDATE collections SET poster_path = ? WHERE id = ?`, *body.PosterPath, id); err != nil {
			writeError(w, "failed to update poster", http.StatusInternalServerError)
			return
		}
	}
	if body.BackdropPath != nil {
		if _, err := h.db.Exec(`UPDATE collections SET backdrop_path = ? WHERE id = ?`, *body.BackdropPath, id); err != nil {
			writeError(w, "failed to update backdrop", http.StatusInternalServerError)
			return
		}
	}
	if body.TmdbCollectionID != nil {
		if _, err := h.db.Exec(`UPDATE collections SET tmdb_collection_id = ? WHERE id = ?`, *body.TmdbCollectionID, id); err != nil {
			writeError(w, "failed to update tmdb id", http.StatusInternalServerError)
			return
		}
	}
	if body.Overview != nil {
		if _, err := h.db.Exec(`UPDATE collections SET overview = ? WHERE id = ?`, *body.Overview, id); err != nil {
			writeError(w, "failed to update overview", http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *CollectionHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	var exists int
	h.db.QueryRow(`SELECT COUNT(*) FROM collections WHERE id = ?`, id).Scan(&exists)
	if exists == 0 {
		writeError(w, "not found", http.StatusNotFound)
		return
	}

	h.db.Exec(`DELETE FROM collection_items WHERE collection_id = ?`, id)
	if _, err := h.db.Exec(`DELETE FROM collections WHERE id = ?`, id); err != nil {
		writeError(w, "failed to delete collection", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *CollectionHandler) SetItems(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	var body struct {
		MediaIDs []int64 `json:"media_ids"`
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

	if _, err := tx.Exec(`DELETE FROM collection_items WHERE collection_id = ?`, id); err != nil {
		writeError(w, "failed to clear items", http.StatusInternalServerError)
		return
	}
	for i, mid := range body.MediaIDs {
		if _, err := tx.Exec(`INSERT INTO collection_items (collection_id, media_id, sort_order) VALUES (?, ?, ?)`, id, mid, i); err != nil {
			writeError(w, "failed to insert item", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, "failed to commit", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *CollectionHandler) Items(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	rows, err := h.db.Query(`
		SELECT mi.id, mi.title, mi.media_type,
		       COALESCE(mi.poster_path, '') as poster_path,
		       mi.duration_seconds
		FROM collection_items ci
		JOIN media_items mi ON mi.id = ci.media_id
		WHERE ci.collection_id = ?
		ORDER BY ci.sort_order, mi.title
	`, id)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type item struct {
		ID              int64  `json:"id"`
		Title           string `json:"title"`
		MediaType       string `json:"media_type"`
		PosterPath      string `json:"poster_path"`
		DurationSeconds int    `json:"duration_seconds"`
	}
	var items []item
	for rows.Next() {
		var i item
		if err := rows.Scan(&i.ID, &i.Title, &i.MediaType, &i.PosterPath, &i.DurationSeconds); err != nil {
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
