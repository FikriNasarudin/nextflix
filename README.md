# Nextflix — Low-Spec Home Media Server

Single-binary Netflix clone for home labs. Go backend + embedded web UI.
Optimized for **< 35 MB RAM** and slow connections.

## Quick Start

```bash
git clone https://github.com/FikriNasarudin/nextflix
cd nextflix
# 1. Put your video files in ./media/
# 2. (Optional) Set your TMDB API key in config.yaml for trending & trailers
docker compose up -d
```

On startup, the **Scanner** walks the media directory and probes new video files with `ffprobe`. HD videos (≥720p) are automatically queued for background **480p HLS encoding** via `nice -n 19 ffmpeg`.

Open **http://localhost:8080** — first-run credentials:

```
Username: admin
Password: admin
```

**Change the password after first login.** The JWT secret is auto-generated and stored in the database on first run.

## Features

- **Direct Play** via `http.ServeContent` for local 1080p files
- **Container Remuxing** (`ffmpeg -c copy`) when streaming unsupported containers
- **480p HLS Downscaling** background low-priority transcoding (`nice -n 19 ffmpeg`)
- **JWT Authentication** with multi-profile support
- **Kids Profiles** with parental rating limits (G, PG, PG-13, R, etc.)
- **3-Layer Content Filtering** — Library, Tag, and Parental Rating
- **TMDB Integration** — daily trending, auto-tagging by genre, YouTube trailers
- **Recommendation Engine** — Continue Watching, Because You Watched, Trending
- **Admin Panel** at `/admin` — user management, library CRUD, tag editor, settings
- **hls.js Player** with 1080p/480p quality switching
- **Hover Preview** with YouTube trailers (1.2s delay)
- **Embedded UI** — all static files compiled into the binary via `go:embed`

## Configuration

| Key | Default | Description |
|---|---|---|
| `server.port` | `8080` | HTTP listen port |
| `server.read_timeout_sec` | `15` | Read timeout |
| `server.write_timeout_sec` | `30` | Write timeout |
| `database.path` | `./data/media.db` | SQLite database path |
| `database.journal_mode` | `WAL` | SQLite journal mode |
| `database.synchronous` | `NORMAL` | SQLite synchronous mode |
| `database.busy_timeout_ms` | `5000` | SQLite busy timeout |
| `scanner.media_dir` | `./media` | Media library directory |
| `scanner.max_concurrent_ffprobes` | `2` | Max parallel ffprobe processes |
| `scanner.scan_batch_size` | `50` | DB insert batch size |
| `scanner.enable_filesystem_watcher` | `true` | Watch for new files |
| `encoder.enable_auto_480p_hls` | `true` | Auto-encode new media to 480p HLS |
| `encoder.hls_segment_duration_sec` | `4` | HLS segment duration |
| `encoder.ffmpeg_preset` | `superfast` | x264 preset for encoding |
| `encoder.hls_output_dir` | `./data/hls` | HLS output directory |
| `integrations.tmdb_api_key` | — | TMDB API key (warning if missing — TMDB features disabled) |
| `ui.theme` | `dark` | UI theme |
| `ui.app_title` | `My Home Netflix` | Browser tab title |

## Content Filtering (3-Layer)

Each profile's content visibility is controlled by three independent layers:

| Layer | Mechanism | Default |
|---|---|---|
| **1. Library** | Admin grants profile access to specific libraries | Empty = no restrictions (all libraries visible) |
| **2. Tag** | Profile has a tag whitelist — only media with allowed tags shown | Empty = no tag filtering |
| **3. Rating** | Profile's `max_rating` field (e.g. PG-13) | Empty = no rating filter |

All three layers are AND-ed together: a profile sees media that passes **all** active filters.

## Database

SQLite3 with WAL mode. 12 tables managed via raw SQL (no ORM). Schema is auto-created on first run:

| Table | Purpose |
|---|---|
| `users` | Auth & role (admin/user) |
| `profiles` | Per-user profiles with parental controls |
| `libraries` | Admin-defined media collections |
| `profile_library_access` | Library whitelist per profile |
| `tags` | TMDB genres + admin custom tags |
| `media_items` | Scanned media files with metadata |
| `media_tags` | M:N media-to-tag assignment |
| `playback_progress` | Continue watching state |
| `watch_history` | Viewing sessions for recommendations |
| `profile_recommendations` | Cached recommendation results |
| `trending_cache` | TMDB daily Top 10 |
| `settings` | Key-value admin settings |

## API Endpoints

### Public

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | No | Main Netflix-style UI |
| `POST` | `/api/v1/auth/login` | No | Login → JWT |

### Authenticated (profile-scoped JWT)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/profiles` | List profiles for user |
| `GET` | `/api/v1/media` | Browse media (filtered by profile) |
| `GET` | `/api/v1/stream/{id}` | Direct Play stream |
| `GET` | `/api/v1/remux/{id}` | Container remux stream |
| `GET` | `/api/v1/hls/{id}/{rest...}` | HLS files (playlist.m3u8, segments/*.ts) |
| `GET` | `/api/v1/progress` | Continue Watching list |
| `PUT` | `/api/v1/progress` | Save playback position |
| `GET` | `/api/v1/recommendations` | All recommendation rows |
| `GET` | `/api/v1/trending` | TMDB Top 10 |

### Admin (`/api/v1/admin/*` — requires admin role)

| Method | Path | Description |
|---|---|---|
| `GET/POST` | `/api/v1/admin/users` | List / Create users |
| `GET/PUT/DELETE` | `/api/v1/admin/users/{id}` | Get / Update / Delete user |
| `GET/POST` | `/api/v1/admin/users/{id}/profiles` | List / Create profiles |
| `GET/PUT/DELETE` | `/api/v1/admin/profiles/{id}` | Get / Update / Delete profile |
| `PUT` | `/api/v1/admin/profiles/{id}/libraries` | Set library access |
| `PUT` | `/api/v1/admin/profiles/{id}/tags` | Set tag whitelist |
| `GET/POST` | `/api/v1/admin/libraries` | List / Create libraries |
| `GET/PUT/DELETE` | `/api/v1/admin/libraries/{id}` | Get / Update / Delete library |
| `GET/POST` | `/api/v1/admin/tags` | List / Create tags |
| `PUT/DELETE` | `/api/v1/admin/tags/{id}` | Update / Delete tag |
| `GET` | `/api/v1/admin/media` | Browse all media |
| `PUT` | `/api/v1/admin/media/{id}` | Update media metadata (tags, library) |
| `POST` | `/api/v1/admin/media/{id}/re-encode` | Trigger re-encode |
| `GET/PUT` | `/api/v1/admin/settings` | Get / Update app settings |

### Admin UI

| Route | Page |
|---|---|
| `/admin` | Dashboard |
| `/admin/users` | User manager |
| `/admin/users/{id}` | Profile manager per user |
| `/admin/libraries` | Library CRUD |
| `/admin/tags` | Tag editor |
| `/admin/media` | Media manager |
| `/admin/settings` | App settings |

## Development

```bash
# Install Go 1.22+, then:
go run .                    # Run directly
CGO_ENABLED=1 go build .    # Build static binary
docker compose up --build   # Build & run in container
```

## Prerequisites

### Docker (recommended — zero manual setup)

Docker handles Go, ffmpeg, and C compiler automatically. Just run:

```bash
docker compose up --build -d
```

### Ubuntu / Debian

```bash
# Install Go 1.22+
wget -q https://go.dev/dl/go1.22.12.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.22.12.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
export PATH=$PATH:/usr/local/go/bin

# Install ffmpeg, ffprobe, and C compiler
sudo apt update && sudo apt install -y ffmpeg gcc musl-dev
```

### macOS (Homebrew)

```bash
brew install go ffmpeg
```

### Verify

```bash
go version    # must be 1.22+
ffmpeg -version   # must work
ffprobe -version  # must work
gcc --version # must work
```

On startup, the server runs a full media scan and starts a filesystem watcher. New video files placed in the media directory are automatically detected, probed, and queued for 480p HLS conversion.

## Architecture

```
┌──────────────┐     ┌───────────────┐     ┌─────────────┐
│   Browser    │     │   Go Server   │     │   SQLite    │
│  (hls.js)    │────▶│  (net/http)   │────▶│  (WAL mode) │
│  YouTube IF  │     │               │     └─────────────┘
└──────────────┘     │  ┌─────────┐  │
                     │  │ Scanner │──┼──▶ fsnotify + ffprobe
                     │  ├─────────┤  │
                     │  │ Encoder │──┼──▶ ffmpeg (nice -n 19)
                     │  ├─────────┤  │
                     │  │  TMDB   │──┼──▶ api.themoviedb.org
                     │  ├─────────┤  │
                     │  │  Admin  │──┼──▶ Full CRUD API
                     │  └─────────┘  │
                     └───────────────┘
```

## License

MIT
