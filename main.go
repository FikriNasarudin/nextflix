package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"nextflix/internal/auth"
	"nextflix/internal/config"
	"nextflix/internal/database"
	"nextflix/internal/encoder"
	"nextflix/internal/handler"
	"nextflix/internal/library"
	"nextflix/internal/recommendation"
	"nextflix/internal/scanner"
	"nextflix/internal/tmdb"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)

	cfgPath := "./config.yaml"
	if p := os.Getenv("NEXTFLIX_CONFIG"); p != "" {
		cfgPath = p
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	log.Printf("Starting Nextflix — %s v0.1.0", cfg.UI.AppTitle)
	log.Printf("Media directory: %s", cfg.Scanner.MediaDir)
	log.Printf("Database: %s", cfg.Database.Path)
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		log.Printf("WARNING: ffmpeg not found in PATH — remux and HLS encoding disabled")
	} else {
		log.Printf("ffmpeg found")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		log.Printf("WARNING: ffprobe not found in PATH — codec detection disabled")
	} else {
		log.Printf("ffprobe found")
	}

	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	if err := database.Migrate(db, cfg); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	authMgr, err := auth.NewManager(db)
	if err != nil {
		log.Fatalf("Failed to init auth: %v", err)
	}

	encoderCh := make(chan scanner.EncoderJob, 100)
	enc := encoder.New(db, cfg.Encoder, encoderCh)
	enc.Recover()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	enc.Start(ctx)

	lm := library.New(db, cfg, encoderCh)
	lm.StartWatcher()

	scanFunc := func() {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("Scanner: panic recovered: %v", rec)
			}
		}()
		lm.ValidateLibrary()
		db.Exec(`INSERT INTO activity_log (type, message) VALUES ('scan', 'Scan complete')`)
		lm.RefreshMetadata()
	}

	refreshFunc := func() {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("Metadata refresh: panic recovered: %v", rec)
			}
		}()
		lm.RefreshMetadata()
	}

	rec := recommendation.NewEngine(db)
	rec.Start()

	tmdbSync := tmdb.NewSync(db)
	tmdbSync.Start()

	srv := &http.Server{
		Addr:         addr(cfg.Server.Port),
		Handler:      handler.NewRouter(db, authMgr, cfg.Encoder.HLSOutputDir, cfg.Scanner.MediaDir, enc, lm, scanFunc, refreshFunc, tmdbSync.Trigger),
		ReadTimeout:  time.Duration(cfg.Server.ReadTimeoutSec) * time.Second,
		WriteTimeout: time.Duration(cfg.Server.WriteTimeoutSec) * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("Listening on :%d", cfg.Server.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	time.Sleep(2 * time.Second)
	log.Println("Server ready — accepting connections, starting initial scan...")

	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("Scanner: panic recovered: %v", rec)
			}
		}()
		lm.ValidateLibrary()
		log.Println("Library: initial scan complete")
		db.Exec(`INSERT INTO activity_log (type, message) VALUES ('scan', 'Scan complete')`)
		lm.RefreshMetadata()
		log.Println("Library: metadata refresh complete")
	}()

	<-ctx.Done()
	log.Println("Shutting down...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	srv.Shutdown(shutdownCtx)
}

func addr(port int) string {
	return ":" + strconv.Itoa(port)
}