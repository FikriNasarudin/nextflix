package handler

import (
	"database/sql"
	"log"
	"net/http"
	"time"

	"nextflix/internal/admin"
	"nextflix/internal/auth"
	"nextflix/internal/middleware"
)

type Router struct {
	mux      *http.ServeMux
	db       *sql.DB
	authMgr  *auth.Manager
	hlsDir   string
	authMid  func(http.Handler) http.Handler
	adminMid func(http.Handler) http.Handler
}

func NewRouter(db *sql.DB, authMgr *auth.Manager, hlsDir string) *Router {
	r := &Router{
		mux:      http.NewServeMux(),
		db:       db,
		authMgr:  authMgr,
		hlsDir:   hlsDir,
		authMid:  middleware.Auth(authMgr),
		adminMid: middleware.RequireAdmin,
	}

	authH := auth.NewHandler(db, authMgr)

	r.mux.HandleFunc("POST /api/v1/auth/login", authH.Login)

	r.mux.Handle("/api/v1/auth/me", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})))

	r.mountMedia()
	r.mountStreaming()
	r.mountProgress()
	r.mountTrending()
	r.mountRecommendations()
	r.mountAdmin()

	log.Println("Routes registered")
	return r
}

func (r *Router) mountMedia() {
	mh := NewMediaHandler(r.db)
	r.mux.Handle("GET /api/v1/media", r.authMid(http.HandlerFunc(mh.List)))
}

func (r *Router) mountStreaming() {
	sh := NewStreamHandler(r.db, r.hlsDir)
	r.mux.Handle("GET /api/v1/stream/{id}", r.authMid(http.HandlerFunc(sh.Serve)))
	r.mux.Handle("GET /api/v1/remux/{id}", r.authMid(http.HandlerFunc(sh.Remux)))
	r.mux.Handle("GET /api/v1/hls/{id}/{rest...}", r.authMid(http.HandlerFunc(sh.HLSFile)))
}

func (r *Router) mountProgress() {
	ph := NewProgressHandler(r.db)
	r.mux.Handle("GET /api/v1/progress", r.authMid(http.HandlerFunc(ph.List)))
	r.mux.Handle("PUT /api/v1/progress", r.authMid(http.HandlerFunc(ph.Update)))
}

func (r *Router) mountTrending() {
	th := NewTrendingHandler(r.db)
	r.mux.Handle("GET /api/v1/trending", r.authMid(http.HandlerFunc(th.List)))
}

func (r *Router) mountRecommendations() {
	rh := NewRecommendationHandler(r.db)
	r.mux.Handle("GET /api/v1/recommendations", r.authMid(http.HandlerFunc(rh.List)))
}

func (r *Router) mountAdmin() {
	uh := admin.NewUserHandler(r.db)
	lh := admin.NewLibraryHandler(r.db)
	th := admin.NewTagHandler(r.db)
	mh := admin.NewMediaHandler(r.db)
	sh := admin.NewSettingsHandler(r.db)

	a := func(h http.HandlerFunc) http.Handler {
		return r.adminMid(r.authMid(h))
	}

	adminMux := http.NewServeMux()

	adminMux.Handle("GET /api/v1/admin/users", a(uh.List))
	adminMux.Handle("POST /api/v1/admin/users", a(uh.Create))
	adminMux.Handle("GET /api/v1/admin/users/{id}", a(uh.Get))
	adminMux.Handle("PUT /api/v1/admin/users/{id}", a(uh.Update))
	adminMux.Handle("DELETE /api/v1/admin/users/{id}", a(uh.Delete))

	adminMux.Handle("GET /api/v1/admin/users/{uid}/profiles", a(uh.ListProfiles))
	adminMux.Handle("POST /api/v1/admin/users/{uid}/profiles", a(uh.CreateProfile))
	adminMux.Handle("PUT /api/v1/admin/profiles/{id}", a(uh.UpdateProfile))
	adminMux.Handle("DELETE /api/v1/admin/profiles/{id}", a(uh.DeleteProfile))

	adminMux.Handle("PUT /api/v1/admin/profiles/{pid}/libraries", a(lh.SetProfileAccess))
	adminMux.Handle("GET /api/v1/admin/profiles/{pid}/libraries", a(lh.GetProfileAccess))

	adminMux.Handle("GET /api/v1/admin/libraries", a(lh.List))
	adminMux.Handle("POST /api/v1/admin/libraries", a(lh.Create))
	adminMux.Handle("PUT /api/v1/admin/libraries/{id}", a(lh.Update))
	adminMux.Handle("DELETE /api/v1/admin/libraries/{id}", a(lh.Delete))

	adminMux.Handle("GET /api/v1/admin/tags", a(th.List))
	adminMux.Handle("POST /api/v1/admin/tags", a(th.Create))
	adminMux.Handle("PUT /api/v1/admin/tags/{id}", a(th.Update))
	adminMux.Handle("DELETE /api/v1/admin/tags/{id}", a(th.Delete))

	adminMux.Handle("GET /api/v1/admin/media/{mid}/tags", a(th.ListMediaTags))
	adminMux.Handle("PUT /api/v1/admin/media/{mid}/tags", a(th.SetMediaTags))

	adminMux.Handle("GET /api/v1/admin/media", a(mh.List))
	adminMux.Handle("PUT /api/v1/admin/media/{id}", a(mh.Update))
	adminMux.Handle("POST /api/v1/admin/media/{id}/re-encode", a(mh.Reencode))

	adminMux.Handle("GET /api/v1/admin/settings", a(sh.List))
	adminMux.Handle("PUT /api/v1/admin/settings", a(sh.Update))

	r.mux.Handle("/api/v1/admin/", r.authMid(r.adminMid(adminMux)))
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	start := time.Now()
	r.mux.ServeHTTP(w, req)
	log.Printf("%s %s %s", req.Method, req.URL.Path, time.Since(start))
}
