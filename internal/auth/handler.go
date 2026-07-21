package auth

import (
	"database/sql"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("__"), bcrypt.DefaultCost)

type Handler struct {
	db            *sql.DB
	manager       *Manager
	loginAttempts map[string]*loginAttempt
	loginMu       sync.Mutex
}

type loginAttempt struct {
	count        int
	blockedUntil time.Time
}

func NewHandler(db *sql.DB, manager *Manager) *Handler {
	return &Handler{
		db:            db,
		manager:       manager,
		loginAttempts: make(map[string]*loginAttempt),
	}
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token    string           `json:"token"`
	Role     string           `json:"role"`
	Profiles []profileSummary `json:"profiles"`
}

type profileSummary struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	IsKid     bool   `json:"is_kid"`
}

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		parts := strings.SplitN(fwd, ",", 2)
		return strings.TrimSpace(parts[0])
	}
	if fwd := r.Header.Get("X-Real-IP"); fwd != "" {
		return strings.TrimSpace(fwd)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ip := clientIP(r)

	h.loginMu.Lock()
	a, exists := h.loginAttempts[ip]
	if !exists {
		a = &loginAttempt{}
		h.loginAttempts[ip] = a
	}
	if a.blockedUntil.After(time.Now()) {
		h.loginMu.Unlock()
		http.Error(w, "Too many login attempts, try again later", http.StatusTooManyRequests)
		return
	}
	a.count++
	isBlocked := a.count >= 5
	if isBlocked {
		a.blockedUntil = time.Now().Add(15 * time.Minute)
	}
	h.loginMu.Unlock()

	if isBlocked {
		http.Error(w, "Too many login attempts, try again later", http.StatusTooManyRequests)
		return
	}

	h.cleanupStaleAttempts()

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
		bcrypt.CompareHashAndPassword(dummyHash, []byte(req.Password))
		h.loginMu.Lock()
		if a := h.loginAttempts[ip]; a != nil {
			a.count++
			if a.count >= 5 {
				a.blockedUntil = time.Now().Add(15 * time.Minute)
			}
		}
		h.loginMu.Unlock()
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

	h.loginMu.Lock()
	delete(h.loginAttempts, ip)
	h.loginMu.Unlock()

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
	if err := rows.Err(); err != nil {
		http.Error(w, "Internal error", http.StatusInternalServerError)
		return
	}

	profileID := int64(-1)
	if len(profiles) > 0 {
		profileID = profiles[0].ID
	}

	token, err := h.manager.GenerateToken(userID, profileID, role)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	resp := loginResponse{Token: token, Role: role, Profiles: profiles}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("auth: failed to encode login response: %v", err)
	}
}

func (h *Handler) cleanupStaleAttempts() {
	h.loginMu.Lock()
	defer h.loginMu.Unlock()
	now := time.Now()
	for k, v := range h.loginAttempts {
		if v.blockedUntil.Before(now) {
			delete(h.loginAttempts, k)
		}
	}
}
