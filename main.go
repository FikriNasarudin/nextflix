package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"nextflix/internal/config"
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
	log.Printf("Listening on :%d", cfg.Server.Port)
	log.Printf("Media directory: %s", cfg.Scanner.MediaDir)
	log.Printf("Database: %s", cfg.Database.Path)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("Shutting down... (%v)", sig)
}
