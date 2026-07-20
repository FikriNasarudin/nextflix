package admin

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
)

type LibraryHandler struct {
	db *sql.DB
}

func NewLibraryHandler(db *sql.DB) *LibraryHandler {
	return &LibraryHandler{db: db}
}

func (h *LibraryHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT id, name, description, library_dir, created_at FROM libraries ORDER BY id`)
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type lib struct {
		ID          int64  `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		LibraryDir  string `json:"library_dir"`
		CreatedAt   string `json:"created_at"`
	}
	var libs []lib
	for rows.Next() {
		var l lib
		if err := rows.Scan(&l.ID, &l.Name, &l.Description, &l.LibraryDir, &l.CreatedAt); err != nil {
			http.Error(w, `{"error":"scan error"}`, http.StatusInternalServerError)
			return
		}
		libs = append(libs, l)
	}
	writeJSON(w, libs)
}

func (h *LibraryHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		LibraryDir  string `json:"library_dir"`
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
		`INSERT INTO libraries (name, description, library_dir) VALUES (?, ?, ?)`,
		body.Name, body.Description, body.LibraryDir,
	)
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	id, _ := result.LastInsertId()
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]int64{"id": id})
}

func (h *LibraryHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		LibraryDir  *string `json:"library_dir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	if body.Name != nil {
		if _, err := h.db.Exec(`UPDATE libraries SET name = ? WHERE id = ?`, *body.Name, id); err != nil {
			http.Error(w, `{"error":"failed to update name"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.Description != nil {
		if _, err := h.db.Exec(`UPDATE libraries SET description = ? WHERE id = ?`, *body.Description, id); err != nil {
			http.Error(w, `{"error":"failed to update description"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.LibraryDir != nil {
		if _, err := h.db.Exec(`UPDATE libraries SET library_dir = ? WHERE id = ?`, *body.LibraryDir, id); err != nil {
			http.Error(w, `{"error":"failed to update library_dir"}`, http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	if _, err := h.db.Exec(`DELETE FROM libraries WHERE id = ?`, id); err != nil {
		http.Error(w, `{"error":"failed to delete library"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) SetProfileAccess(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.ParseInt(r.PathValue("pid"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid profile id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		LibraryIDs []int64 `json:"library_ids"`
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

	tx.Exec(`DELETE FROM profile_library_access WHERE profile_id = ?`, pid)
	for _, lid := range body.LibraryIDs {
		tx.Exec(`INSERT INTO profile_library_access (profile_id, library_id) VALUES (?, ?)`, pid, lid)
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, `{"error":"failed to commit"}`, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) GetProfileAccess(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.ParseInt(r.PathValue("pid"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid profile id"}`, http.StatusBadRequest)
		return
	}

	rows, err := h.db.Query(
		`SELECT library_id FROM profile_library_access WHERE profile_id = ? ORDER BY library_id`, pid,
	)
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			http.Error(w, `{"error":"scan error"}`, http.StatusInternalServerError)
			return
		}
		ids = append(ids, id)
	}
	writeJSON(w, map[string][]int64{"library_ids": ids})
}
