package auth

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"golang.org/x/crypto/bcrypt"
)

type Handler struct {
	db      *sql.DB
	manager *Manager
}

func NewHandler(db *sql.DB, manager *Manager) *Handler {
	return &Handler{db: db, manager: manager}
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token    string           `json:"token"`
	Profiles []profileSummary `json:"profiles"`
}

type profileSummary struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	IsKid     bool   `json:"is_kid"`
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var userID int64
	var passwordHash, role string
	err := h.db.QueryRow(
		`SELECT id, password_hash, role FROM users WHERE username = ? AND is_active = 1`,
		req.Username,
	).Scan(&userID, &passwordHash, &role)
	if err == sql.ErrNoRows {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}
	if err != nil {
		http.Error(w, "Internal error", http.StatusInternalServerError)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	rows, err := h.db.Query(
		`SELECT id, name, avatar_url, is_kid FROM profiles WHERE user_id = ? ORDER BY id`,
		userID,
	)
	if err != nil {
		http.Error(w, "Internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var profiles []profileSummary
	for rows.Next() {
		var p profileSummary
		if err := rows.Scan(&p.ID, &p.Name, &p.AvatarURL, &p.IsKid); err != nil {
			continue
		}
		profiles = append(profiles, p)
	}

	profileID := int64(0)
	if len(profiles) > 0 {
		profileID = profiles[0].ID
	}

	token, err := h.manager.GenerateToken(userID, profileID, role)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	resp := loginResponse{Token: token, Profiles: profiles}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
