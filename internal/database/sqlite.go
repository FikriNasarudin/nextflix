package database

import (
	"database/sql"
	"fmt"
	"time"

	"nextflix/internal/config"

	_ "github.com/mattn/go-sqlite3"
)

func Open(cfg config.DatabaseConfig) (*sql.DB, error) {
	dsn := fmt.Sprintf(
		"%s?_journal_mode=%s&_busy_timeout=%d&_synchronous=%s",
		cfg.Path, cfg.JournalMode, cfg.BusyTimeoutMs, cfg.Synchronous,
	)

	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}

	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("pinging database: %w", err)
	}

	pragmas := []string{
		"PRAGMA journal_mode=WAL;",
		"PRAGMA synchronous=NORMAL;",
		"PRAGMA busy_timeout=5000;",
		"PRAGMA foreign_keys=ON;",
		"PRAGMA cache_size=-8000;",
		"PRAGMA temp_store=MEMORY;",
		"PRAGMA mmap_size=268435456;",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			return nil, fmt.Errorf("setting pragma %s: %w", p, err)
		}
	}

	return db, nil
}
