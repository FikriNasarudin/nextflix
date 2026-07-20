# Agent Instructions: Low-Spec Full-Stack Media Server (Go + Embedded UI)

## Core Principles & Performance Boundaries
- **Backend Target**: Go 1.22+ native binary. Resource usage must remain under **35MB RAM** and **<2% CPU** at idle.
- **Embedded UI**: Compile all static files (`/web/*`) directly into the Go executable using `go:embed`.
- **Database**: SQLite3 via `mattn/go-sqlite3` using raw SQL queries (no ORM). Require `PRAGMA journal_mode=WAL;`, `PRAGMA synchronous=NORMAL;`, and `PRAGMA busy_timeout=5000;`.
- **Transcoding Strategy**:
  - Direct Play via `http.ServeContent` for local 1080p files.
  - Live container remuxing (`ffmpeg -c copy`) when streaming unsupported containers.
  - Background low-priority 480p HLS downscaling (`nice -n 19 ffmpeg`) triggered when 1080p media is added.

## Database Schema Targets
- `users`: `id`, `username`, `password_hash`, `created_at`
- `profiles`: `id`, `user_id`, `name`, `avatar_url`, `is_kid`, `max_rating`
- `media_items`: `id`, `library_id`, `title`, `media_type`, `tmdb_id`, `rating`, `file_path`, `duration_seconds`, `trailer_youtube_id`, `created_at`
- `playback_progress`: `profile_id`, `media_id`, `position_seconds`, `is_finished`, `updated_at`
- `trending_cache`: `tmdb_id`, `title`, `poster_path`, `media_type`, `rank`, `updated_at`