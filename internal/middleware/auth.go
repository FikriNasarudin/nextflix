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
		var token string
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" {
			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				http.Error(w, "Invalid Authorization header format", http.StatusUnauthorized)
				return
			}
			token = parts[1]
		} else {
			token = r.URL.Query().Get("token")
			if token == "" {
				http.Error(w, "Missing Authorization header or token", http.StatusUnauthorized)
				return
			}
		}

		claims, err := manager.ValidateToken(token)
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

func UserIDFromContext(ctx context.Context) int64 {
	v, _ := ctx.Value(ContextUserID).(int64)
	return v
}

func ProfileIDFromContext(ctx context.Context) int64 {
	v, _ := ctx.Value(ContextProfileID).(int64)
	return v
}

func RoleFromContext(ctx context.Context) string {
	v, _ := ctx.Value(ContextRole).(string)
	return v
}
