package database

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"

	"nextflix/internal/config"

	"golang.org/x/crypto/bcrypt"
)

func Migrate(db *sql.DB, cfg *config.Config) error {
	schema := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS profiles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			is_kid INTEGER NOT NULL DEFAULT 0,
			max_rating TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS libraries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS profile_library_access (
			profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
			library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
			PRIMARY KEY (profile_id, library_id)
		);`,

		`CREATE TABLE IF NOT EXISTS tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			tmdb_genre_id INTEGER DEFAULT NULL
		);`,

		`CREATE TABLE IF NOT EXISTS media_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
			title TEXT NOT NULL,
			media_type TEXT NOT NULL DEFAULT 'movie',
			tmdb_id INTEGER DEFAULT NULL,
			rating TEXT DEFAULT '',
			file_path TEXT NOT NULL,
			duration_seconds INTEGER DEFAULT 0,
			trailer_youtube_id TEXT DEFAULT '',
			backdrop_path TEXT DEFAULT '',
			poster_path TEXT DEFAULT '',
			hls_480p_path TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE INDEX IF NOT EXISTS idx_media_library ON media_items(library_id);`,
		`CREATE INDEX IF NOT EXISTS idx_media_tmdb ON media_items(tmdb_id);`,
		`CREATE INDEX IF NOT EXISTS idx_media_filepath ON media_items(file_path);`,

		`CREATE TABLE IF NOT EXISTS media_tags (
			media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
			tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
			PRIMARY KEY (media_id, tag_id)
		);`,

		`CREATE TABLE IF NOT EXISTS playback_progress (
			profile_id INTEGER NOT NULL,
			media_id INTEGER NOT NULL,
			position_seconds INTEGER NOT NULL DEFAULT 0,
			is_finished INTEGER NOT NULL DEFAULT 0,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (profile_id, media_id),
			FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
			FOREIGN KEY (media_id) REFERENCES media_items(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS watch_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
			media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
			watched_seconds INTEGER NOT NULL DEFAULT 0,
			duration_seconds INTEGER NOT NULL DEFAULT 0,
			is_completed INTEGER NOT NULL DEFAULT 0,
			watched_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE INDEX IF NOT EXISTS idx_wh_profile ON watch_history(profile_id, watched_at DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_wh_media ON watch_history(media_id);`,
		`CREATE INDEX IF NOT EXISTS idx_wh_completed ON watch_history(is_completed) WHERE is_completed = 1;`,

		`CREATE TABLE IF NOT EXISTS profile_recommendations (
			profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
			section TEXT NOT NULL,
			media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
			score REAL NOT NULL,
			refreshed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (profile_id, section, media_id)
		);`,

		`CREATE TABLE IF NOT EXISTS trending_cache (
			tmdb_id INTEGER PRIMARY KEY,
			title TEXT NOT NULL,
			poster_path TEXT DEFAULT '',
			media_type TEXT NOT NULL,
			rank INTEGER NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);`,
	}

	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("migration failed: %w\nSQL: %s", err, stmt)
		}
	}

	if err := seedSettings(db, cfg); err != nil {
		return fmt.Errorf("seeding settings: %w", err)
	}

	if err := seedAdmin(db); err != nil {
		return fmt.Errorf("seeding admin user: %w", err)
	}

	log.Println("Database migrations complete")
	return nil
}

func seedSettings(db *sql.DB, cfg *config.Config) error {
	defaults := map[string]string{
		"tmdb_api_key":              cfg.Integrations.TmdbAPIKey,
		"scanner_media_dir":         cfg.Scanner.MediaDir,
		"scanner_enable_watcher":    fmt.Sprintf("%t", cfg.Scanner.EnableFilesystemWatcher),
		"encoder_enable_480p_hls":   fmt.Sprintf("%t", cfg.Encoder.EnableAuto480pHLS),
		"encoder_hls_segment_sec":   fmt.Sprintf("%d", cfg.Encoder.HLSSegmentDurationSec),
		"encoder_ffmpeg_preset":     cfg.Encoder.FFmpegPreset,
		"encoder_hls_output_dir":    cfg.Encoder.HLSOutputDir,
		"ui_app_title":              cfg.UI.AppTitle,
		"ui_theme":                  cfg.UI.Theme,
		"recommendations_enabled":   "true",
		"trending_window_days":      "7",
	}

	for k, v := range defaults {
		_, err := db.Exec(
			`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
			k, v,
		)
		if err != nil {
			return fmt.Errorf("seeding setting %s: %w", k, err)
		}
	}
	return nil
}

func seedAdmin(db *sql.DB) error {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	if err != nil {
		return fmt.Errorf("checking user count: %w", err)
	}
	if count > 0 {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hashing password: %w", err)
	}

	_, err = db.Exec(
		`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`,
		"admin", string(hash),
	)
	if err != nil {
		return fmt.Errorf("creating admin user: %w", err)
	}

	_, err = db.Exec(
		`INSERT INTO profiles (user_id, name) VALUES (?, ?)`,
		1, "Default",
	)
	if err != nil {
		return fmt.Errorf("creating default profile: %w", err)
	}

	token := make([]byte, 16)
	rand.Read(token)

	log.Println("========================================")
	log.Println("  First run — admin user created")
	log.Println("  Username: admin")
	log.Println("  Password: admin")
	log.Printf("  Secret:   %s", hex.EncodeToString(token))
	log.Println("  ** Change the password after first login **")
	log.Println("========================================")

	return nil
}
