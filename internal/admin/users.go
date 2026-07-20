package admin

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"golang.org/x/crypto/bcrypt"
)

type UserHandler struct {
	db *sql.DB
}

func NewUserHandler(db *sql.DB) *UserHandler {
	return &UserHandler{db: db}
}

func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT id, username, role, is_active, created_at FROM users ORDER BY id`)
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type user struct {
		ID        int64  `json:"id"`
		Username  string `json:"username"`
		Role      string `json:"role"`
		IsActive  bool   `json:"is_active"`
		CreatedAt string `json:"created_at"`
	}
	var users []user
	for rows.Next() {
		var u user
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &u.IsActive, &u.CreatedAt); err != nil {
			http.Error(w, `{"error":"scan error"}`, http.StatusInternalServerError)
			return
		}
		users = append(users, u)
	}
	writeJSON(w, users)
}

func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	if body.Username == "" || body.Password == "" {
		http.Error(w, `{"error":"username and password required"}`, http.StatusBadRequest)
		return
	}
	if body.Role == "" {
		body.Role = "user"
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, `{"error":"failed to hash password"}`, http.StatusInternalServerError)
		return
	}

	result, err := h.db.Exec(
		`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
		body.Username, string(hash), body.Role,
	)
	if err != nil {
		http.Error(w, `{"error":"username already exists"}`, http.StatusConflict)
		return
	}

	id, _ := result.LastInsertId()
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]int64{"id": id})
}

func (h *UserHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}

	var u struct {
		ID        int64  `json:"id"`
		Username  string `json:"username"`
		Role      string `json:"role"`
		IsActive  bool   `json:"is_active"`
		CreatedAt string `json:"created_at"`
	}
	err = h.db.QueryRow(
		`SELECT id, username, role, is_active, created_at FROM users WHERE id = ?`, id,
	).Scan(&u.ID, &u.Username, &u.Role, &u.IsActive, &u.CreatedAt)
	if err == sql.ErrNoRows {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, u)
}

func (h *UserHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Username *string `json:"username"`
		Password *string `json:"password"`
		Role     *string `json:"role"`
		IsActive *bool   `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	if body.Username != nil {
		if _, err := h.db.Exec(`UPDATE users SET username = ? WHERE id = ?`, *body.Username, id); err != nil {
			http.Error(w, `{"error":"failed to update username"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.Password != nil {
		hash, err := bcrypt.GenerateFromPassword([]byte(*body.Password), bcrypt.DefaultCost)
		if err != nil {
			http.Error(w, `{"error":"failed to hash password"}`, http.StatusInternalServerError)
			return
		}
		if _, err := h.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, string(hash), id); err != nil {
			http.Error(w, `{"error":"failed to update password"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.Role != nil {
		if _, err := h.db.Exec(`UPDATE users SET role = ? WHERE id = ?`, *body.Role, id); err != nil {
			http.Error(w, `{"error":"failed to update role"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.IsActive != nil {
		if _, err := h.db.Exec(`UPDATE users SET is_active = ? WHERE id = ?`, *body.IsActive, id); err != nil {
			http.Error(w, `{"error":"failed to update status"}`, http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}
func (h *UserHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}

	requestUserID := userIDFromContext(r)
	if id == requestUserID {
		http.Error(w, `{"error":"cannot delete your own account"}`, http.StatusForbidden)
		return
	}

	if _, err := h.db.Exec(`DELETE FROM users WHERE id = ?`, id); err != nil {
		http.Error(w, `{"error":"failed to delete user"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *UserHandler) ListProfiles(w http.ResponseWriter, r *http.Request) {
	uid, err := strconv.ParseInt(r.PathValue("uid"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid user id"}`, http.StatusBadRequest)
		return
	}

	rows, err := h.db.Query(
		`SELECT id, name, avatar_url, is_kid, max_rating, created_at FROM profiles WHERE user_id = ? ORDER BY id`, uid,
	)
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type profile struct {
		ID        int64  `json:"id"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
		IsKid     bool   `json:"is_kid"`
		MaxRating string `json:"max_rating"`
		CreatedAt string `json:"created_at"`
	}
	var profiles []profile
	for rows.Next() {
		var p profile
		if err := rows.Scan(&p.ID, &p.Name, &p.AvatarURL, &p.IsKid, &p.MaxRating, &p.CreatedAt); err != nil {
			http.Error(w, `{"error":"scan error"}`, http.StatusInternalServerError)
			return
		}
		profiles = append(profiles, p)
	}
	writeJSON(w, profiles)
}

func (h *UserHandler) CreateProfile(w http.ResponseWriter, r *http.Request) {
	uid, err := strconv.ParseInt(r.PathValue("uid"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid user id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
		IsKid     bool   `json:"is_kid"`
		MaxRating string `json:"max_rating"`
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
		`INSERT INTO profiles (user_id, name, avatar_url, is_kid, max_rating) VALUES (?, ?, ?, ?, ?)`,
		uid, body.Name, body.AvatarURL, body.IsKid, body.MaxRating,
	)
	if err != nil {
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]int64{"id": id})
}

func (h *UserHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid profile id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Name      *string `json:"name"`
		AvatarURL *string `json:"avatar_url"`
		IsKid     *bool   `json:"is_kid"`
		MaxRating *string `json:"max_rating"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	if body.Name != nil {
		if _, err := h.db.Exec(`UPDATE profiles SET name = ? WHERE id = ?`, *body.Name, id); err != nil {
			http.Error(w, `{"error":"failed to update name"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.AvatarURL != nil {
		if _, err := h.db.Exec(`UPDATE profiles SET avatar_url = ? WHERE id = ?`, *body.AvatarURL, id); err != nil {
			http.Error(w, `{"error":"failed to update avatar"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.IsKid != nil {
		if _, err := h.db.Exec(`UPDATE profiles SET is_kid = ? WHERE id = ?`, *body.IsKid, id); err != nil {
			http.Error(w, `{"error":"failed to update is_kid"}`, http.StatusInternalServerError)
			return
		}
	}
	if body.MaxRating != nil {
		if _, err := h.db.Exec(`UPDATE profiles SET max_rating = ? WHERE id = ?`, *body.MaxRating, id); err != nil {
			http.Error(w, `{"error":"failed to update max_rating"}`, http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *UserHandler) DeleteProfile(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, `{"error":"invalid profile id"}`, http.StatusBadRequest)
		return
	}
	if _, err := h.db.Exec(`DELETE FROM profiles WHERE id = ?`, id); err != nil {
		http.Error(w, `{"error":"failed to delete profile"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
