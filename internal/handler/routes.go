package handler

import (
	"database/sql"
	"log"
	"net/http"
	"time"

	"nextflix/internal/auth"
	"nextflix/internal/middleware"
)

type Router struct {
	mux      *http.ServeMux
	db       *sql.DB
	authMgr  *auth.Manager
	authMid  func(http.Handler) http.Handler
	adminMid func(http.Handler) http.Handler
}

func NewRouter(db *sql.DB, authMgr *auth.Manager) *Router {
	r := &Router{
		mux:      http.NewServeMux(),
		db:       db,
		authMgr:  authMgr,
		authMid:  middleware.Auth(authMgr),
		adminMid: middleware.RequireAdmin,
	}

	authH := auth.NewHandler(db, authMgr)

	r.mux.HandleFunc("POST /api/v1/auth/login", authH.Login)

	r.mux.Handle("/api/v1/auth/me", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})))

	log.Println("Routes registered")
	return r
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	start := time.Now()
	r.mux.ServeHTTP(w, req)
	log.Printf("%s %s %s", req.Method, req.URL.Path, time.Since(start))
}
