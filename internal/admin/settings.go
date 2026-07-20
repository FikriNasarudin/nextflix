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
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	settings := make(map[string]string)
	for rows.Next() {
		var k, v string
		rows.Scan(&k, &v)
		settings[k] = v
	}
	writeJSON(w, settings)
}

func (h *SettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	for k, v := range body {
		h.db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, k, v, v)
	}
	w.WriteHeader(http.StatusNoContent)
}
