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
			library_dir TEXT DEFAULT '',
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
			show_name TEXT DEFAULT '',
			season_number INTEGER DEFAULT 0,
			episode_number INTEGER DEFAULT 0,
			episode_title TEXT DEFAULT '',
			year TEXT DEFAULT '',
			overview TEXT DEFAULT '',
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

		`CREATE TABLE IF NOT EXISTS media_images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			media_id INTEGER REFERENCES media_items(id) ON DELETE CASCADE,
			image_type TEXT NOT NULL,
			file_path TEXT NOT NULL,
			is_primary INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS show_images (
			show_name TEXT NOT NULL,
			image_type TEXT NOT NULL,
			season_number INTEGER NOT NULL DEFAULT 0,
			file_path TEXT NOT NULL,
			PRIMARY KEY (show_name, image_type, season_number)
		);`,

		`CREATE TABLE IF NOT EXISTS media_subtitles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
			language TEXT NOT NULL DEFAULT 'und',
			codec TEXT NOT NULL DEFAULT 'srt',
			file_path TEXT NOT NULL,
			is_forced INTEGER NOT NULL DEFAULT 0,
			is_external INTEGER NOT NULL DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS media_audio_tracks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
			language TEXT NOT NULL DEFAULT 'und',
			codec TEXT NOT NULL,
			channels INTEGER NOT NULL DEFAULT 2,
			stream_index INTEGER NOT NULL,
			title TEXT DEFAULT '',
			is_default INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS collections (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			tmdb_collection_id INTEGER UNIQUE,
			name TEXT NOT NULL,
			poster_path TEXT DEFAULT '',
			backdrop_path TEXT DEFAULT '',
			overview TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,

		`CREATE TABLE IF NOT EXISTS collection_items (
			collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
			media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
			sort_order INTEGER DEFAULT 0,
			PRIMARY KEY (collection_id, media_id)
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

	// v2: add library_dir column to existing libraries
	db.Exec(`ALTER TABLE libraries ADD COLUMN library_dir TEXT DEFAULT ''`)

	// v3: add TV/metadata columns to media_items
	db.Exec(`ALTER TABLE media_items ADD COLUMN show_name TEXT DEFAULT ''`)
	db.Exec(`ALTER TABLE media_items ADD COLUMN season_number INTEGER DEFAULT 0`)
	db.Exec(`ALTER TABLE media_items ADD COLUMN episode_number INTEGER DEFAULT 0`)
	db.Exec(`ALTER TABLE media_items ADD COLUMN episode_title TEXT DEFAULT ''`)
	db.Exec(`ALTER TABLE media_items ADD COLUMN year TEXT DEFAULT ''`)

	// add overview column to media_items (may already exist in fresh installs)
	db.Exec(`ALTER TABLE media_items ADD COLUMN overview TEXT DEFAULT ''`)

	// v5: add group_id column for multi-version grouping
	db.Exec(`ALTER TABLE media_items ADD COLUMN group_id INTEGER DEFAULT NULL`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_media_group ON media_items(group_id)`)

	// v6: activity log
	db.Exec(`CREATE TABLE IF NOT EXISTS activity_log (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		type TEXT NOT NULL,
		message TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(created_at DESC)`)

	// seed initial activity
	var actCount int
	db.QueryRow(`SELECT COUNT(*) FROM activity_log`).Scan(&actCount)
	if actCount == 0 {
		db.Exec(`INSERT INTO activity_log (type, message) VALUES ('system', 'Server initialized')`)
	}

	// v8: media_credits table for cast & crew
	db.Exec(`CREATE TABLE IF NOT EXISTS media_credits (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
		tmdb_person_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'actor',
		character_name TEXT DEFAULT '',
		profile_path TEXT DEFAULT '',
		sort_order INTEGER DEFAULT 0,
		UNIQUE(media_id, tmdb_person_id, role, character_name)
	)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_credits_media ON media_credits(media_id, sort_order)`)

	// v4: create image/subtitle/audio/collection tables (IF NOT EXISTS handles fresh installs)
	db.Exec(`CREATE TABLE IF NOT EXISTS media_images (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		media_id INTEGER REFERENCES media_items(id) ON DELETE CASCADE,
		image_type TEXT NOT NULL,
		file_path TEXT NOT NULL,
		is_primary INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE IF NOT EXISTS show_images (
		show_name TEXT NOT NULL,
		image_type TEXT NOT NULL,
		season_number INTEGER NOT NULL DEFAULT 0,
		file_path TEXT NOT NULL,
		PRIMARY KEY (show_name, image_type, season_number)
	)`)
	db.Exec(`CREATE TABLE IF NOT EXISTS media_subtitles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
		language TEXT NOT NULL DEFAULT 'und',
		codec TEXT NOT NULL DEFAULT 'srt',
		file_path TEXT NOT NULL,
		is_forced INTEGER NOT NULL DEFAULT 0,
		is_external INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE IF NOT EXISTS media_audio_tracks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
		language TEXT NOT NULL DEFAULT 'und',
		codec TEXT NOT NULL,
		channels INTEGER NOT NULL DEFAULT 2,
		stream_index INTEGER NOT NULL,
		title TEXT DEFAULT '',
		is_default INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE IF NOT EXISTS collections (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tmdb_collection_id INTEGER UNIQUE,
		name TEXT NOT NULL,
		poster_path TEXT DEFAULT '',
		backdrop_path TEXT DEFAULT '',
		overview TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE IF NOT EXISTS collection_items (
		collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
		media_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
		sort_order INTEGER DEFAULT 0,
		PRIMARY KEY (collection_id, media_id)
	)`	)

	// v7: library media_type + library_folders (Jellyfin-style multi-folder libraries)
	db.Exec(`ALTER TABLE libraries ADD COLUMN media_type TEXT DEFAULT 'movie'`)

	db.Exec(`CREATE TABLE IF NOT EXISTS library_folders (
		library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
		folder_path TEXT NOT NULL,
		PRIMARY KEY (library_id, folder_path)
	)`)

	// Migrate existing library_dir into library_folders
	db.Exec(`INSERT OR IGNORE INTO library_folders (library_id, folder_path)
		SELECT id, library_dir FROM libraries WHERE library_dir != '' AND library_dir IS NOT NULL`)

	// Set media_type for existing libraries based on directory name
	db.Exec(`UPDATE libraries SET media_type = 'tv'
		WHERE LOWER(library_dir) IN ('tvshows', 'tv', 'tv-shows', 'tv shows', 'television', 'series', 'anime')`)
	db.Exec(`UPDATE libraries SET media_type = 'movie'
		WHERE LOWER(library_dir) IN ('movies', 'movie', 'films', 'film', 'moviess', 'mmovies')`)

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

	db.Exec(`UPDATE media_items SET poster_path = '' WHERE poster_path LIKE '/%/%'`)
	db.Exec(`UPDATE media_items SET backdrop_path = '' WHERE backdrop_path LIKE '/%/%'`)

	db.Exec(`DELETE FROM media_items WHERE file_path != '' AND id NOT IN (SELECT MIN(id) FROM media_items WHERE file_path != '' GROUP BY file_path)`)
	db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_media_filepath_unique ON media_items(file_path)`)

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
