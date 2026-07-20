package middleware

import (
	"context"
	"net/http"
	"strings"

	"nextflix/internal/auth"
)

type contextKey string

const (
	ContextUserID    contextKey = "user_id"
	ContextProfileID contextKey = "profile_id"
	ContextRole      contextKey = "role"
)

func Auth(manager *auth.Manager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, "Missing Authorization header", http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				http.Error(w, "Invalid Authorization header format", http.StatusUnauthorized)
				return
			}

			claims, err := manager.ValidateToken(parts[1])
			if err != nil {
				http.Error(w, "Invalid or expired token", http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), ContextUserID, claims.UserID)
			ctx = context.WithValue(ctx, ContextProfileID, claims.ProfileID)
			ctx = context.WithValue(ctx, ContextRole, claims.Role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role, ok := r.Context().Value(ContextRole).(string)
		if !ok || role != "admin" {
			http.Error(w, "Forbidden: admin access required", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
