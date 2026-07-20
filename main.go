package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"nextflix/internal/config"
	"nextflix/internal/database"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)

	cfgPath := "./config.yaml"
	if p := os.Getenv("NEXFLIX_CONFIG"); p != "" {
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

	log.Printf("Listening on :%d", cfg.Server.Port)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("Shutting down... (%v)", sig)
}
