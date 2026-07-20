package handler

import (
	"database/sql"
	"encoding/json"
	"html/template"
	"log"
	"net/http"
	"os/exec"
	"strconv"
	"time"

	"nextflix/internal/admin"
	"nextflix/internal/auth"
	"nextflix/internal/middleware"
	"nextflix/internal/scanner"
	"nextflix/web"
)

type Router struct {
	mux      *http.ServeMux
	db       *sql.DB
	authMgr  *auth.Manager
	hlsDir   string
	authMid  func(http.Handler) http.Handler
	adminMid func(http.Handler) http.Handler
	scanner  *scanner.Scanner
}

func NewRouter(db *sql.DB, authMgr *auth.Manager, hlsDir string, scn *scanner.Scanner) *Router {
	r := &Router{
		mux:      http.NewServeMux(),
		db:       db,
		authMgr:  authMgr,
		hlsDir:   hlsDir,
		authMid:  middleware.Auth(authMgr),
		adminMid: middleware.RequireAdmin,
		scanner:  scn,
	}

	authH := auth.NewHandler(db, authMgr)

	r.mux.HandleFunc("POST /api/v1/auth/login", authH.Login)

	r.mux.Handle("GET /api/v1/auth/me", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		userID := middleware.UserIDFromContext(req.Context())
		if userID == 0 {
			writeError(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var role string
		if err := r.db.QueryRow(`SELECT role FROM users WHERE id = ?`, userID).Scan(&role); err != nil {
			writeError(w, "user not found", http.StatusNotFound)
			return
		}
		writeJSON(w, map[string]string{"role": role})
	})))

	r.mountMedia()
	r.mountStreaming()
	r.mountProgress()
	r.mountTrending()
	r.mountRecommendations()
	r.mountAssets()
	r.mountCollections()
	r.mountFrontend()
	r.mountHealth()
	r.mountAdmin()

	log.Println("Routes registered")
	return r
}

func (r *Router) mountMedia() {
	mh := NewMediaHandler(r.db)
	r.mux.Handle("GET /api/v1/media", r.authMid(http.HandlerFunc(mh.List)))
	r.mux.Handle("GET /api/v1/libraries", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		rows, err := r.db.Query(`SELECT id, name FROM libraries ORDER BY name`)
		if err != nil {
			http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		type lib struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		}
		var libs []lib
		for rows.Next() {
			var l lib
			rows.Scan(&l.ID, &l.Name)
			libs = append(libs, l)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(libs)
	})))
}

func (r *Router) mountHealth() {
	r.mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, req *http.Request) {
		dbOK := r.db.Ping() == nil
		_, ffmpegOK := exec.LookPath("ffmpeg")
		_, ffprobeOK := exec.LookPath("ffprobe")
		writeJSON(w, map[string]any{
			"status":  "ok",
			"db":      dbOK,
			"ffmpeg":  ffmpegOK == nil,
			"ffprobe": ffprobeOK == nil,
		})
	})
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

func (r *Router) mountAssets() {
	r.mux.Handle("GET /api/v1/media/{id}/images", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(req.PathValue("id"), 10, 64)
		if err != nil { writeError(w, "invalid id", http.StatusBadRequest); return }
		rows, err := r.db.Query(`SELECT id, image_type, file_path, is_primary FROM media_images WHERE media_id = ? ORDER BY image_type, is_primary DESC`, id)
		if err != nil { writeError(w, "database error", http.StatusInternalServerError); return }
		defer rows.Close()
		type img struct { ID int64 `json:"id"`; Type string `json:"image_type"`; Path string `json:"file_path"`; Primary bool `json:"is_primary"` }
		var list []img
		for rows.Next() { var i img; rows.Scan(&i.ID, &i.Type, &i.Path, &i.Primary); list = append(list, i) }
		if list == nil { list = []img{} }
		writeJSON(w, list)
	})))

	r.mux.Handle("GET /api/v1/media/{id}/subtitles", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(req.PathValue("id"), 10, 64)
		if err != nil { writeError(w, "invalid id", http.StatusBadRequest); return }
		rows, err := r.db.Query(`SELECT id, language, codec, file_path, is_forced, is_external FROM media_subtitles WHERE media_id = ? ORDER BY language`, id)
		if err != nil { writeError(w, "database error", http.StatusInternalServerError); return }
		defer rows.Close()
		type sub struct { ID int64 `json:"id"`; Lang string `json:"language"`; Codec string `json:"codec"`; Path string `json:"file_path"`; Forced bool `json:"is_forced"`; External bool `json:"is_external"` }
		var list []sub
		for rows.Next() { var s sub; rows.Scan(&s.ID, &s.Lang, &s.Codec, &s.Path, &s.Forced, &s.External); list = append(list, s) }
		if list == nil { list = []sub{} }
		writeJSON(w, list)
	})))

	r.mux.Handle("GET /api/v1/media/{id}/audio", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(req.PathValue("id"), 10, 64)
		if err != nil { writeError(w, "invalid id", http.StatusBadRequest); return }
		rows, err := r.db.Query(`SELECT id, language, codec, channels, stream_index, title, is_default FROM media_audio_tracks WHERE media_id = ? ORDER BY stream_index`, id)
		if err != nil { writeError(w, "database error", http.StatusInternalServerError); return }
		defer rows.Close()
		type aud struct { ID int64 `json:"id"`; Lang string `json:"language"`; Codec string `json:"codec"`; Channels int `json:"channels"`; StreamIdx int `json:"stream_index"`; Title string `json:"title"`; Default bool `json:"is_default"` }
		var list []aud
		for rows.Next() { var a aud; rows.Scan(&a.ID, &a.Lang, &a.Codec, &a.Channels, &a.StreamIdx, &a.Title, &a.Default); list = append(list, a) }
		if list == nil { list = []aud{} }
		writeJSON(w, list)
	})))

	r.mux.Handle("GET /api/v1/image/local/{imageType}/{id}", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		imgType := req.PathValue("imageType")
		id, err := strconv.ParseInt(req.PathValue("id"), 10, 64)
		if err != nil { writeError(w, "invalid id", http.StatusBadRequest); return }
		var path string
		err = r.db.QueryRow(`SELECT file_path FROM media_images WHERE media_id = ? AND image_type = ? ORDER BY is_primary DESC LIMIT 1`, id, imgType).Scan(&path)
		if err != nil { writeError(w, "not found", http.StatusNotFound); return }
		http.ServeFile(w, req, path)
	})))

	r.mux.Handle("GET /api/v1/subtitle/{id}/file", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(req.PathValue("id"), 10, 64)
		if err != nil { writeError(w, "invalid id", http.StatusBadRequest); return }
		var path, codec string
		err = r.db.QueryRow(`SELECT file_path, codec FROM media_subtitles WHERE id = ?`, id).Scan(&path, &codec)
		if err != nil { writeError(w, "not found", http.StatusNotFound); return }
		mime := map[string]string{"srt": "text/plain", "vtt": "text/vtt", "ass": "text/plain", "ssa": "text/plain", "sub": "text/plain", "idx": "text/plain"}
		if ct, ok := mime[codec]; ok { w.Header().Set("Content-Type", ct) }
		http.ServeFile(w, req, path)
	})))
}

func (r *Router) mountCollections() {
	ch := NewCollectionHandler(r.db)
	r.mux.Handle("GET /api/v1/collections", r.authMid(http.HandlerFunc(ch.List)))
	r.mux.Handle("GET /api/v1/collections/{id}", r.authMid(http.HandlerFunc(ch.Get)))
	r.mux.Handle("GET /api/v1/collections/{id}/items", r.authMid(http.HandlerFunc(ch.Items)))
}

func (r *Router) mountFrontend() {
	r.mux.Handle("/static/", http.FileServer(http.FS(web.FS)))

	r.mux.HandleFunc("/admin", func(w http.ResponseWriter, req *http.Request) {
		tmpl := template.Must(template.ParseFS(web.FS, "templates/admin/layout.html"))
		tmpl.Execute(w, nil)
	})
	r.mux.HandleFunc("/admin/", func(w http.ResponseWriter, req *http.Request) {
		tmpl := template.Must(template.ParseFS(web.FS, "templates/admin/layout.html"))
		tmpl.Execute(w, nil)
	})

	r.mux.HandleFunc("/player.html", func(w http.ResponseWriter, req *http.Request) {
		tmpl := template.Must(template.ParseFS(web.FS, "templates/layout.html", "templates/player.html"))
		tmpl.Execute(w, map[string]string{"Title": "Player — Nextflix"})
	})

	r.mux.HandleFunc("/", func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/" && req.URL.Path != "/index.html" {
			http.NotFound(w, req)
			return
		}
		tmpl := template.Must(template.ParseFS(web.FS, "templates/layout.html", "templates/index.html"))
		tmpl.Execute(w, map[string]string{"Title": "Nextflix"})
	})
}

func (r *Router) mountAdmin() {
	uh := admin.NewUserHandler(r.db)
	lh := admin.NewLibraryHandler(r.db)
	th := admin.NewTagHandler(r.db)
	mh := admin.NewMediaHandler(r.db)
	sh := admin.NewSettingsHandler(r.db)
	ch := admin.NewCollectionHandler(r.db)

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

	adminMux.Handle("GET /api/v1/admin/collections", a(ch.List))
	adminMux.Handle("POST /api/v1/admin/collections", a(ch.Create))
	adminMux.Handle("PUT /api/v1/admin/collections/{id}", a(ch.Update))
	adminMux.Handle("DELETE /api/v1/admin/collections/{id}", a(ch.Delete))
	adminMux.Handle("PUT /api/v1/admin/collections/{id}/items", a(ch.SetItems))

	adminMux.Handle("POST /api/v1/admin/scan", a(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('scan', 'Manual scan started')`)
		go func() {
			r.scanner.ScanAll()
			r.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('scan', 'Scan complete')`)
		}()
		writeJSON(w, map[string]string{"status": "scan started"})
	})))

	adminMux.Handle("GET /api/v1/admin/scan/status", a(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		prog := r.scanner.Progress()
		writeJSON(w, map[string]any{
			"running":   prog.Running,
			"current":   prog.Current,
			"total":     prog.Total,
			"library":   prog.Library,
			"last_item": prog.LastItem,
		})
	})))

	adminMux.Handle("GET /api/v1/admin/activity", a(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		rows, err := r.db.Query(`SELECT id, type, message, created_at FROM activity_log ORDER BY created_at DESC LIMIT 20`)
		if err != nil {
			writeError(w, "database error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		type entry struct {
			ID        int64  `json:"id"`
			Type      string `json:"type"`
			Message   string `json:"message"`
			CreatedAt string `json:"created_at"`
		}
		var list []entry
		for rows.Next() {
			var e entry
			rows.Scan(&e.ID, &e.Type, &e.Message, &e.CreatedAt)
			list = append(list, e)
		}
		if list == nil {
			list = []entry{}
		}
		writeJSON(w, list)
	})))

	r.mux.Handle("/api/v1/admin/", r.authMid(r.adminMid(adminMux)))
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	start := time.Now()
	r.mux.ServeHTTP(w, req)
	log.Printf("%s %s %s", req.Method, req.URL.Path, time.Since(start))
}
