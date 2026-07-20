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

	type setting struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	var list []setting
	for rows.Next() {
		var s setting
		if err := rows.Scan(&s.Key, &s.Value); err != nil {
			http.Error(w, `{"error":"scan error"}`, http.StatusInternalServerError)
			return
		}
		list = append(list, s)
	}
	if list == nil {
		list = []setting{}
	}
	writeJSON(w, list)
}

func (h *SettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	for k, v := range body {
		if k == "jwt_secret" {
			continue
		}
		if _, err := h.db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, k, v, v); err != nil {
			http.Error(w, `{"error":"failed to save setting"}`, http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
