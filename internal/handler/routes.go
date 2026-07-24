package handler

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"nextflix/internal/admin"
	"nextflix/internal/auth"
	"nextflix/internal/library"
	"nextflix/internal/middleware"
	"nextflix/internal/scanner"
	"nextflix/internal/transcoder"
	"nextflix/web"
)

const placeholderSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="300" height="450" fill="#1a1a2e"/><circle cx="150" cy="200" r="32" fill="none" stroke="#4e4351" stroke-width="2"/><polygon points="141,188 141,212 166,200" fill="#4e4351"/><text x="150" y="255" fill="#9a8c9d" font-family="sans-serif" font-size="11" text-anchor="middle">No Poster</text></svg>`

var textSubCodecs = map[string]bool{
	"subrip": true, "srt": true, "ass": true, "ssa": true,
	"mov_text": true, "webvtt": true, "vtt": true, "text": true,
}

var imageSubCodecs = map[string]bool{
	"pgssub": true, "hdmv_pgs": true, "dvd_subtitle": true,
	"dvdsub": true, "dvb_subtitle": true, "xsub": true,
}

type Router struct {
	mux         *http.ServeMux
	db          *sql.DB
	authMgr     *auth.Manager
	mediaDir    string
	sm          *transcoder.SessionManager
	authMid     func(http.Handler) http.Handler
	adminMid    func(http.Handler) http.Handler
	scanner     *scanner.Scanner
	lm          *library.LibraryManager
	scanFunc    func()
	refreshFunc func()
	syncFunc    func()
}

func NewRouter(db *sql.DB, authMgr *auth.Manager, mediaDir string, lm *library.LibraryManager, scanFunc func(), refreshFunc func(), syncFunc func(), sm *transcoder.SessionManager) *Router {
	r := &Router{
		mux:         http.NewServeMux(),
		db:          db,
		authMgr:     authMgr,
		mediaDir:    mediaDir,
		sm:          sm,
		authMid:     middleware.Auth(authMgr),
		adminMid:    middleware.RequireAdmin,
		scanner:     lm.Scanner(),
		lm:          lm,
		scanFunc:    scanFunc,
		refreshFunc: refreshFunc,
		syncFunc:    syncFunc,
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
			if err := rows.Scan(&l.ID, &l.Name); err != nil {
				http.Error(w, `{"error":"scan error"}`, http.StatusInternalServerError)
				return
			}
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
	sh := NewStreamHandler(r.db)
	th := NewTranscodeHandler(r.db, r.sm)
	r.mux.Handle("GET /api/v1/stream/{id}", r.authMid(http.HandlerFunc(sh.Serve)))
	r.mux.Handle("GET /api/v1/transcode/{id}/master.m3u8", r.authMid(http.HandlerFunc(th.Master)))
	r.mux.Handle("GET /api/v1/transcode/{id}/{rest...}", r.authMid(http.HandlerFunc(th.Segment)))
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
		for rows.Next() { var i img
			if err := rows.Scan(&i.ID, &i.Type, &i.Path, &i.Primary); err != nil {
				writeError(w, "scan error", http.StatusInternalServerError)
				return
			}
			list = append(list, i)
		}
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
		for rows.Next() { var s sub
			if err := rows.Scan(&s.ID, &s.Lang, &s.Codec, &s.Path, &s.Forced, &s.External); err != nil {
				writeError(w, "scan error", http.StatusInternalServerError)
				return
			}
			list = append(list, s)
		}
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
		for rows.Next() { var a aud
			if err := rows.Scan(&a.ID, &a.Lang, &a.Codec, &a.Channels, &a.StreamIdx, &a.Title, &a.Default); err != nil {
				writeError(w, "scan error", http.StatusInternalServerError)
				return
			}
			list = append(list, a)
		}
		if list == nil { list = []aud{} }
		writeJSON(w, list)
	})))

	r.mux.Handle("GET /api/v1/image/local/{imageType}/{id}", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		imgType := req.PathValue("imageType")
		id, err := strconv.ParseInt(req.PathValue("id"), 10, 64)
		if err != nil { writeError(w, "invalid id", http.StatusBadRequest); return }
		var path string
		err = r.db.QueryRow(`SELECT file_path FROM media_images WHERE media_id = ? AND image_type = ? ORDER BY is_primary DESC LIMIT 1`, id, imgType).Scan(&path)
		if err != nil {
			if imgType == "backdrop" {
				var showName string
				if err2 := r.db.QueryRow(`SELECT show_name FROM media_items WHERE id = ?`, id).Scan(&showName); err2 == nil && showName != "" {
					var sp string
					err3 := r.db.QueryRow(`SELECT file_path FROM show_images WHERE show_name = ? AND image_type = 'backdrop' AND season_number = 0 LIMIT 1`, showName).Scan(&sp)
					if err3 == nil {
						w.Header().Set("Cache-Control", "public, max-age=86400")
						http.ServeFile(w, req, sp)
						return
					}
				}
			}
			if imgType == "poster" {
				var showName, seasonNumberStr string
				if err2 := r.db.QueryRow(`SELECT show_name, COALESCE(season_number, 0) || '' FROM media_items WHERE id = ?`, id).Scan(&showName, &seasonNumberStr); err2 == nil && showName != "" {
					seasonNum, _ := strconv.Atoi(seasonNumberStr)
					if seasonNum > 0 {
						var sp string
						err3 := r.db.QueryRow(`SELECT file_path FROM show_images WHERE show_name = ? AND image_type = 'season_poster' AND season_number = ? LIMIT 1`, showName, seasonNum).Scan(&sp)
						if err3 == nil {
							w.Header().Set("Cache-Control", "public, max-age=86400")
							http.ServeFile(w, req, sp)
							return
						}
					}
					var sp string
					err4 := r.db.QueryRow(`SELECT file_path FROM show_images WHERE show_name = ? AND image_type = 'poster' AND season_number = 0 ORDER BY file_path LIMIT 1`, showName).Scan(&sp)
					if err4 == nil {
						w.Header().Set("Cache-Control", "public, max-age=86400")
						http.ServeFile(w, req, sp)
						return
					}
				}
			}
			w.Header().Set("Content-Type", "image/svg+xml")
			w.Header().Set("Cache-Control", "public, max-age=86400")
			w.Write([]byte(placeholderSVG))
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFile(w, req, path)
	})))
	r.mux.Handle("GET /api/v1/image/tmdb/{size}/{rest...}", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		size := req.PathValue("size")
		rest := req.PathValue("rest")
		validSizes := map[string]bool{"w92": true, "w154": true, "w185": true, "w342": true, "w500": true, "w780": true, "w1280": true, "original": true}
		if !validSizes[size] {
			writeError(w, "invalid size", http.StatusBadRequest)
			return
		}
		rest = filepath.Clean("/" + rest)[1:]
		if rest == "" || rest == "." {
			writeError(w, "invalid path", http.StatusBadRequest)
			return
		}
		imgURL := "https://image.tmdb.org/t/p/" + size + "/" + rest
		resp, err := http.Get(imgURL)
		if err != nil {
			writeError(w, "tmdb unavailable", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
		io.Copy(w, resp.Body)
	})))

	r.mux.Handle("GET /api/v1/media/{id}/collection", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(req.PathValue("id"), 10, 64)
		if err != nil { writeError(w, "invalid id", http.StatusBadRequest); return }
		var collID, tmdbCollID int64
		var collName string
		err = r.db.QueryRow(`
			SELECT c.id, c.name, c.tmdb_collection_id
			FROM collection_items ci
			JOIN collections c ON c.id = ci.collection_id
			WHERE ci.media_id = ?
			LIMIT 1
		`, id).Scan(&collID, &collName, &tmdbCollID)
		if err == sql.ErrNoRows {
			writeJSON(w, nil)
			return
		}
		if err != nil { writeError(w, "database error", http.StatusInternalServerError); return }

		rows, err := r.db.Query(`
			SELECT mi.id, mi.title, mi.media_type, mi.duration_seconds,
			MAX(CASE WHEN mp.file_path IS NOT NULL THEN '' WHEN si.file_path IS NOT NULL THEN '' ELSE COALESCE(mi.poster_path, '') END) as poster_path
			FROM collection_items ci
			JOIN media_items mi ON mi.id = ci.media_id
			LEFT JOIN media_images mp ON mp.media_id = mi.id AND mp.image_type = 'poster' AND mp.is_primary = 1
			LEFT JOIN show_images si ON si.show_name = mi.show_name AND si.image_type = 'poster' AND si.season_number = 0
			WHERE ci.collection_id = ?
			GROUP BY mi.id
			ORDER BY ci.sort_order, mi.title
		`, collID)
		if err != nil { writeError(w, "database error", http.StatusInternalServerError); return }
		defer rows.Close()

		type item struct {
			ID              int64  `json:"id"`
			Title           string `json:"title"`
			MediaType       string `json:"media_type"`
			DurationSeconds int    `json:"duration_seconds"`
			PosterPath      string `json:"poster_path"`
		}
		var items []item
		for rows.Next() {
			var i item
			if err := rows.Scan(&i.ID, &i.Title, &i.MediaType, &i.DurationSeconds, &i.PosterPath); err != nil {
				writeError(w, "scan error", http.StatusInternalServerError)
				return
			}
			items = append(items, i)
		}
		if items == nil { items = []item{} }

		writeJSON(w, map[string]any{
			"id":   collID,
			"name": collName,
			"tmdb_collection_id": tmdbCollID,
			"items": items,
		})
	})))

	r.mux.Handle("GET /api/v1/media/{id}/credits", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(req.PathValue("id"), 10, 64)
		if err != nil { writeError(w, "invalid id", http.StatusBadRequest); return }
		rows, err := r.db.Query(`SELECT id, tmdb_person_id, name, role, character_name, profile_path, sort_order FROM media_credits WHERE media_id = ? ORDER BY sort_order`, id)
		if err != nil { writeError(w, "database error", http.StatusInternalServerError); return }
		defer rows.Close()
		type credit struct {
			ID          int64  `json:"id"`
			PersonID    int64  `json:"tmdb_person_id"`
			Name        string `json:"name"`
			Role        string `json:"role"`
			Character   string `json:"character"`
			ProfilePath string `json:"profile_path"`
			SortOrder   int    `json:"sort_order"`
		}
		var list []credit
		for rows.Next() {
			var c credit
			if err := rows.Scan(&c.ID, &c.PersonID, &c.Name, &c.Role, &c.Character, &c.ProfilePath, &c.SortOrder); err != nil {
				writeError(w, "scan error", http.StatusInternalServerError)
				return
			}
			list = append(list, c)
		}
		if list == nil { list = []credit{} }
		writeJSON(w, list)
	})))

	r.mux.Handle("GET /api/v1/subtitle/{id}/file", r.authMid(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(req.PathValue("id"), 10, 64)
		if err != nil { writeError(w, "invalid id", http.StatusBadRequest); return }

		var path, codec string
		var mediaID int64
		var streamIndex int
		err = r.db.QueryRow(`SELECT s.file_path, s.codec, s.media_id, s.stream_index FROM media_subtitles s WHERE s.id = ?`, id).Scan(&path, &codec, &mediaID, &streamIndex)
		if err != nil { writeError(w, "not found", http.StatusNotFound); return }

		// Fast path: file already on disk
		if path != "" {
			if codec == "vtt" || codec == "webvtt" {
				w.Header().Set("Content-Type", "text/vtt")
				w.Header().Set("Cache-Control", "public, max-age=86400")
				http.ServeFile(w, req, path)
				return
			}
			if codec == "srt" {
				data, err := os.ReadFile(path)
				if err != nil { writeError(w, "file not found", http.StatusNotFound); return }
				content := strings.ReplaceAll(string(data), ",", ".")
				if !strings.HasPrefix(content, "WEBVTT") {
					content = "WEBVTT\n\n" + content
				}
				w.Header().Set("Content-Type", "text/vtt")
				w.Header().Set("Cache-Control", "public, max-age=86400")
				w.Write([]byte(content))
				return
			}
			// Other text formats (ass, ssa, sub, idx) — serve raw
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("Cache-Control", "public, max-age=86400")
			http.ServeFile(w, req, path)
			return
		}

		// No file path — image subtitle?
		if imageSubCodecs[codec] {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnsupportedMediaType)
			json.NewEncoder(w).Encode(map[string]any{
				"error":         "unsupported image-based subtitle format",
				"subtitle_type": "image",
			})
			return
		}

		// Not a text extractable codec
		if !textSubCodecs[codec] {
			writeError(w, "unsupported subtitle format", http.StatusUnsupportedMediaType)
			return
		}

		// On-demand extraction from source media
		var mediaPath string
		err = r.db.QueryRow(`SELECT file_path FROM media_items WHERE id = ?`, mediaID).Scan(&mediaPath)
		if err != nil { writeError(w, "source media not found", http.StatusNotFound); return }

		ctx, cancel := context.WithTimeout(req.Context(), 30*time.Second)
		defer cancel()

		cmd := exec.CommandContext(ctx, "ffmpeg",
			"-i", mediaPath,
			"-map", fmt.Sprintf("0:%d", streamIndex),
			"-f", "webvtt",
			"-",
		)

		var stderrBuf bytes.Buffer
		cmd.Stderr = &stderrBuf

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			log.Printf("Subtitle: stdout pipe error for id=%d: %v", id, err)
			writeError(w, "extraction error", http.StatusInternalServerError)
			return
		}

		if err := cmd.Start(); err != nil {
			log.Printf("Subtitle: start error for id=%d: %v", id, err)
			writeError(w, "extraction error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/vtt")
		w.Header().Set("Cache-Control", "public, max-age=86400")

		_, copyErr := io.Copy(w, stdout)

		if waitErr := cmd.Wait(); waitErr != nil {
			log.Printf("Subtitle: ffmpeg failed for id=%d: %v, stderr: %s", id, waitErr, stderrBuf.String())
		}

		if copyErr != nil {
			log.Printf("Subtitle: copy error for id=%d: %v", id, copyErr)
		}
	})))
}

func (r *Router) mountCollections() {
	ch := NewCollectionHandler(r.db)
	r.mux.Handle("GET /api/v1/collections", r.authMid(http.HandlerFunc(ch.List)))
	r.mux.Handle("GET /api/v1/collections/{id}", r.authMid(http.HandlerFunc(ch.Get)))
	r.mux.Handle("GET /api/v1/collections/{id}/items", r.authMid(http.HandlerFunc(ch.Items)))
}

func (r *Router) mountFrontend() {
	distFS, err := fs.Sub(web.FS, "dist")
	if err != nil {
		log.Fatalf("failed to get dist sub-filesystem: %v", err)
	}

	r.mux.Handle("GET /assets/", http.FileServer(http.FS(distFS)))

	r.mux.HandleFunc("/admin", func(w http.ResponseWriter, req *http.Request) {
		data, err := web.FS.ReadFile("dist/admin/index.html")
		if err != nil {
			http.NotFound(w, req)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})
	r.mux.HandleFunc("/admin/", func(w http.ResponseWriter, req *http.Request) {
		data, err := web.FS.ReadFile("dist/admin/index.html")
		if err != nil {
			http.NotFound(w, req)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})

	r.mux.HandleFunc("/{rest...}", func(w http.ResponseWriter, req *http.Request) {
		data, err := web.FS.ReadFile("dist/index.html")
		if err != nil {
			http.NotFound(w, req)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})
}

func (r *Router) mountAdmin() {
	uh := admin.NewUserHandler(r.db)
	lh := admin.NewLibraryHandler(r.db, r.mediaDir)
	th := admin.NewTagHandler(r.db)
	mh := admin.NewMediaHandler(r.db, r.lm)
	sh := admin.NewSettingsHandler(r.db)
	ch := admin.NewCollectionHandler(r.db)
	sth := admin.NewStatsHandler(r.db)

	a := func(h http.HandlerFunc) http.Handler {
		return r.authMid(r.adminMid(h))
	}

	adminMux := http.NewServeMux()

	adminMux.Handle("GET /api/v1/admin/directories", a(lh.ListDirectories))

	adminMux.Handle("GET /api/v1/admin/stats", a(sth.Get))

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
	adminMux.Handle("GET /api/v1/admin/media/{id}", a(mh.Get))
	adminMux.Handle("PUT /api/v1/admin/media/{id}", a(mh.Update))
	adminMux.Handle("POST /api/v1/admin/media/{id}/refresh-metadata", a(mh.RefreshMetadata))

	adminMux.Handle("GET /api/v1/admin/media/{id}/streams", a(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		id, err := strconv.ParseInt(req.PathValue("id"), 10, 64)
		if err != nil { writeError(w, "invalid id", http.StatusBadRequest); return }
		admin.NewEncodingHandler(r.db).Streams(w, req, id)
	})))

	adminMux.Handle("GET /api/v1/admin/settings", a(sh.List))
	adminMux.Handle("PUT /api/v1/admin/settings", a(sh.Update))

	adminMux.Handle("GET /api/v1/admin/collections", a(ch.List))
	adminMux.Handle("POST /api/v1/admin/collections", a(ch.Create))
	adminMux.Handle("PUT /api/v1/admin/collections/{id}", a(ch.Update))
	adminMux.Handle("DELETE /api/v1/admin/collections/{id}", a(ch.Delete))
	adminMux.Handle("PUT /api/v1/admin/collections/{id}/items", a(ch.SetItems))
	adminMux.Handle("GET /api/v1/admin/collections/{id}/items", a(ch.Items))

	adminMux.Handle("POST /api/v1/admin/scan", a(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if _, err := r.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('scan', 'Manual scan started')`); err != nil {
			writeError(w, "database error", http.StatusInternalServerError)
			return
		}
		go func() {
			defer func() {
				if rec := recover(); rec != nil {
					log.Printf("Scanner: panic recovered: %v", rec)
				}
			}()
			r.scanFunc()
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

	adminMux.Handle("POST /api/v1/admin/refresh-metadata", a(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if _, err := r.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('system', 'Metadata refresh started')`); err != nil {
			writeError(w, "database error", http.StatusInternalServerError)
			return
		}
		go func() {
			defer func() {
				if rec := recover(); rec != nil {
					log.Printf("Metadata refresh: panic recovered: %v", rec)
				}
			}()
			r.refreshFunc()
			r.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('system', 'Metadata refresh complete')`)
		}()
		writeJSON(w, map[string]string{"status": "metadata refresh started"})
	})))
	adminMux.Handle("POST /api/v1/admin/refresh-metadata-missing", a(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if _, err := r.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('system', 'Metadata refresh (missing) started')`); err != nil {
			writeError(w, "database error", http.StatusInternalServerError)
			return
		}
		go func() {
			defer func() {
				if rec := recover(); rec != nil {
					log.Printf("Metadata refresh missing: panic recovered: %v", rec)
				}
			}()
			rows, err := r.db.Query(`SELECT id FROM media_items WHERE enrich_status IN ('missing','failed')`)
			if err != nil {
				log.Printf("Metadata refresh missing: query error: %v", err)
				return
			}
			defer rows.Close()
			var ids []int64
			for rows.Next() {
				var id int64
				rows.Scan(&id)
				ids = append(ids, id)
			}
			rows.Close()
			for _, id := range ids {
				if err := r.lm.RefreshItem(id); err != nil {
					log.Printf("Metadata refresh missing: item %d: %v", id, err)
				}
			}
			r.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('system', 'Metadata refresh (missing) complete')`)
		}()
		writeJSON(w, map[string]string{"status": "metadata refresh started"})
	})))

	adminMux.Handle("POST /api/v1/admin/sync-tmdb", a(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if _, err := r.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('system', 'TMDB sync started')`); err != nil {
			writeError(w, "database error", http.StatusInternalServerError)
			return
		}
		go func() {
			defer func() {
				if rec := recover(); rec != nil {
					log.Printf("TMDB sync: panic recovered: %v", rec)
				}
			}()
			r.syncFunc()
			r.db.Exec(`INSERT INTO activity_log (type, message) VALUES ('system', 'TMDB sync complete')`)
		}()
		writeJSON(w, map[string]string{"status": "tmdb sync started"})
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
			if err := rows.Scan(&e.ID, &e.Type, &e.Message, &e.CreatedAt); err != nil {
				writeError(w, "scan error", http.StatusInternalServerError)
				return
			}
			list = append(list, e)
		}
		if list == nil {
			list = []entry{}
		}
		if err := rows.Err(); err != nil {
			writeError(w, "rows error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, list)
	})))

	r.mux.Handle("/api/v1/admin/", adminMux)
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	start := time.Now()
	r.mux.ServeHTTP(w, req)
	log.Printf("%s %s %s", req.Method, req.URL.Path, time.Since(start))
}
