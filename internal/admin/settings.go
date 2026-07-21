package admin

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type SettingsHandler struct {
	db *sql.DB
}

func NewSettingsHandler(db *sql.DB) *SettingsHandler {
	return &SettingsHandler{db: db}
}

func (h *SettingsHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT key, value FROM settings ORDER BY key`)
	if err != nil {
		writeError(w, "database error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			writeError(w, "scan error", http.StatusInternalServerError)
			return
		}
		result[k] = v
	}
	if err := rows.Err(); err != nil {
		writeError(w, "rows error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}

func (h *SettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, "invalid request", http.StatusBadRequest)
		return
	}

	for k, v := range body {
		if k == "jwt_secret" {
			continue
		}
		if _, err := h.db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, k, v, v); err != nil {
			writeError(w, "failed to save setting", http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
