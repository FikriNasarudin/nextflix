package admin

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
)

type LibraryHandler struct {
	db       *sql.DB
	mediaDir string
}

func NewLibraryHandler(db *sql.DB, mediaDir string) *LibraryHandler {
	return &LibraryHandler{db: db, mediaDir: mediaDir}
}

func (h *LibraryHandler) ListDirectories(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(h.mediaDir)
	if err != nil {
		writeError(w, "cannot read media dir", http.StatusInternalServerError)
		return
	}
	var dirs []string
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			dirs = append(dirs, e.Name())
		}
	}
	sort.Strings(dirs)
	writeJSON(w, emptySlice(dirs))
}

type libraryResponse struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	MediaType   string   `json:"media_type"`
	FolderPaths []string `json:"folder_paths"`
	CreatedAt   string   `json:"created_at"`
}

func (h *LibraryHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT id, name, description, media_type, created_at FROM libraries ORDER BY id`)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var libs []libraryResponse
	for rows.Next() {
		var l libraryResponse
		if err := rows.Scan(&l.ID, &l.Name, &l.Description, &l.MediaType, &l.CreatedAt); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		l.FolderPaths = h.loadFolders(l.ID)
		libs = append(libs, l)
	}
	if err := rows.Err(); err != nil {
		writeError(w, "rows error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, emptySlice(libs))
}

func (h *LibraryHandler) loadFolders(libID int64) []string {
	rows, err := h.db.Query(`SELECT folder_path FROM library_folders WHERE library_id = ? ORDER BY folder_path`, libID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			continue
		}
		paths = append(paths, p)
	}
	return paths
}

func (h *LibraryHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		MediaType   string   `json:"media_type"`
		FolderPaths []string `json:"folder_paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, "invalid request", http.StatusBadRequest)
		return
	}
	if body.Name == "" {
		writeError(w, "name required", http.StatusBadRequest)
		return
	}
	if body.MediaType == "" {
		body.MediaType = "movie"
	}
	if len(body.FolderPaths) == 0 {
		writeError(w, "at least one folder required", http.StatusBadRequest)
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	result, err := tx.Exec(
		`INSERT INTO libraries (name, description, media_type) VALUES (?, ?, ?)`,
		body.Name, body.Description, body.MediaType,
	)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	id, _ := result.LastInsertId()

	for _, p := range body.FolderPaths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO library_folders (library_id, folder_path) VALUES (?, ?)`, id, p,
		); err != nil {
			log.Printf("admin: insert folder %s: %v", p, err)
		}
	}

	if err := tx.Commit(); err != nil {
		writeError(w, "failed to commit", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]int64{"id": id})
}

func (h *LibraryHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	var body struct {
		Name        *string  `json:"name"`
		Description *string  `json:"description"`
		MediaType   *string  `json:"media_type"`
		FolderPaths []string `json:"folder_paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, "invalid request", http.StatusBadRequest)
		return
	}

	var exists int
	h.db.QueryRow(`SELECT COUNT(*) FROM libraries WHERE id = ?`, id).Scan(&exists)
	if exists == 0 {
		writeError(w, "not found", http.StatusNotFound)
		return
	}

	if body.Name != nil {
		h.db.Exec(`UPDATE libraries SET name = ? WHERE id = ?`, *body.Name, id)
	}
	if body.Description != nil {
		h.db.Exec(`UPDATE libraries SET description = ? WHERE id = ?`, *body.Description, id)
	}
	if body.MediaType != nil {
		h.db.Exec(`UPDATE libraries SET media_type = ? WHERE id = ?`, *body.MediaType, id)
	}
	if len(body.FolderPaths) > 0 {
		tx, err := h.db.Begin()
		if err != nil {
			writeError(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		tx.Exec(`DELETE FROM library_folders WHERE library_id = ?`, id)
		for _, p := range body.FolderPaths {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			tx.Exec(`INSERT INTO library_folders (library_id, folder_path) VALUES (?, ?)`, id, p)
		}

		if err := tx.Commit(); err != nil {
			writeError(w, "failed to commit", http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, "invalid id", http.StatusBadRequest)
		return
	}

	var exists int
	h.db.QueryRow(`SELECT COUNT(*) FROM libraries WHERE id = ?`, id).Scan(&exists)
	if exists == 0 {
		writeError(w, "not found", http.StatusNotFound)
		return
	}

	h.db.Exec(`DELETE FROM library_folders WHERE library_id = ?`, id)
	h.db.Exec(`DELETE FROM profile_library_access WHERE library_id = ?`, id)
	if _, err := h.db.Exec(`DELETE FROM libraries WHERE id = ?`, id); err != nil {
		writeError(w, "failed to delete library", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) SetProfileAccess(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.ParseInt(r.PathValue("pid"), 10, 64)
	if err != nil {
		writeError(w, "invalid profile id", http.StatusBadRequest)
		return
	}

	var body struct {
		LibraryIDs []int64 `json:"library_ids"`
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

	if _, err := tx.Exec(`DELETE FROM profile_library_access WHERE profile_id = ?`, pid); err != nil {
		writeError(w, "failed to clear access", http.StatusInternalServerError)
		return
	}
	for _, lid := range body.LibraryIDs {
		if _, err := tx.Exec(`INSERT INTO profile_library_access (profile_id, library_id) VALUES (?, ?)`, pid, lid); err != nil {
			writeError(w, "failed to insert access", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, "failed to commit", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) GetProfileAccess(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.ParseInt(r.PathValue("pid"), 10, 64)
	if err != nil {
		writeError(w, "invalid profile id", http.StatusBadRequest)
		return
	}

	rows, err := h.db.Query(
		`SELECT library_id FROM profile_library_access WHERE profile_id = ? ORDER BY library_id`, pid,
	)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		writeError(w, "rows error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string][]int64{"library_ids": emptySlice(ids)})
}
