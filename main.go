package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"nextflix/internal/auth"
	"nextflix/internal/config"
	"nextflix/internal/database"
	"nextflix/internal/encoder"
	"nextflix/internal/handler"
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
	enc.Start()

	scn := scanner.New(db, cfg.Scanner, encoderCh)
	scn.Watch()
	go scn.ScanAll()

	rec := recommendation.NewEngine(db)
	rec.Start()

	tmdbSync := tmdb.NewSync(db)
	tmdbSync.Start()

	srv := &http.Server{
		Addr:         addr(cfg.Server.Port),
		Handler:      handler.NewRouter(db, authMgr, cfg.Encoder.HLSOutputDir),
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

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("Shutting down... (%v)", sig)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}

func addr(port int) string {
	return ":" + strconv.Itoa(port)
}
