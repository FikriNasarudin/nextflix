package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID    int64  `json:"user_id"`
	ProfileID int64  `json:"profile_id"`
	Role      string `json:"role"`
	jwt.RegisteredClaims
}

type Manager struct {
	db     *sql.DB
	secret []byte
}

func NewManager(db *sql.DB) (*Manager, error) {
	m := &Manager{db: db}
	if err := m.loadOrGenerateSecret(); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *Manager) loadOrGenerateSecret() error {
	var secretHex string
	err := m.db.QueryRow(`SELECT value FROM settings WHERE key = 'jwt_secret'`).Scan(&secretHex)
	if err == nil {
		m.secret = []byte(secretHex)
		return nil
	}
	if err != sql.ErrNoRows {
		return fmt.Errorf("reading jwt_secret: %w", err)
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Errorf("generating jwt_secret: %w", err)
	}
	secretHex = hex.EncodeToString(buf)
	if _, err := m.db.Exec(`INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)`, secretHex); err != nil {
		return fmt.Errorf("storing jwt_secret: %w", err)
	}
	m.secret = []byte(secretHex)
	return nil
}

func (m *Manager) GenerateToken(userID, profileID int64, role string) (string, error) {
	claims := Claims{
		UserID:    userID,
		ProfileID: profileID,
		Role:      role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(72 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
}

func (m *Manager) ValidateToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}
