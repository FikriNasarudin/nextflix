package admin

import (
	"encoding/json"
	"io"
	"net/http"

	"nextflix/internal/middleware"
)

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		http.Error(w, `{"error":"encode failed"}`, http.StatusInternalServerError)
	}
}

func writeError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v any) error {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, v)
}

func userIDFromContext(r *http.Request) int64 {
	return middleware.UserIDFromContext(r.Context())
}

func emptySlice[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
