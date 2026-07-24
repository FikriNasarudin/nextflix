# Nextflix — Low-Spec Home Media Server

Single-binary Netflix clone for home labs. Go backend + React SPA compiled into one binary.
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

During playback, the HLS player dynamically adapts quality based on your connection speed, offering 360p, 480p, 720p, and full-resolution (capped at 1080p) renditions on-demand. HEVC/HDR sources are tone-mapped and downscaled in real-time — no setup required.

Open **http://localhost:8080** — first-run credentials:

```
Username: admin
Password: admin
```

**Change the password after first login.** The JWT secret is auto-generated and stored in the database on first run.

## Features

- **Direct Play** via `http.ServeContent` for local 1080p files
- **Container Remuxing** (`ffmpeg -c copy`) when streaming unsupported containers
- **Adaptive HLS** with 360p, 480p, 720p, and full-resolution (capped at 1080p) on-demand transcoding — auto-switches to match bandwidth
- **HDR Tone-Mapping** — HEVC/HDR sources are tonemapped to SDR on-the-fly
- **JWT Authentication** with multi-profile support
- **Kids Profiles** with parental rating limits (G, PG, PG-13, R, etc.)
- **3-Layer Content Filtering** — Library, Tag, and Parental Rating
- **TMDB Integration** — daily trending, auto-tagging by genre, YouTube trailers
- **Recommendation Engine** — Continue Watching, Because You Watched, Trending
- **Admin Panel** at `/admin` — user management, library CRUD, tag editor, settings
- **hls.js Player** with automatic quality switching + manual resolution selector
- **Hover Preview** with YouTube trailers (1.2s delay)
- **Embedded React SPA** — React 18 + React Router + TanStack Query, compiled into the binary via `go:embed`

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
| `data.dir` | `./data` | Root data directory (Jellyfin: ProgramDataPath) |
| `data.metadata_dir` | `./data/metadata/library` | Per-item metadata + images (Jellyfin: InternalMetadataPath) |
| `data.image_cache_dir` | `./data/images/tmdb` | Shared TMDB image cache |
| `data.collections_dir` | `./data/collections` | Collection JSON files |
| `scanner.media_dir` | `./media` | Media library directory |
| `scanner.max_concurrent_ffprobes` | `2` | Max parallel ffprobe processes |
| `scanner.scan_batch_size` | `50` | DB insert batch size |
| `scanner.enable_filesystem_watcher` | `true` | Watch for new files |
| `transcoder.hls_segment_duration_sec` | `4` | HLS segment duration |
| `transcoder.hls_list_size` | `30` | HLS live window (in segments). Larger = more resilient to stalls but uses more shmDir space |
| `transcoder.shm_dir` | `/dev/shm/homestream` | Temp directory for HLS segments (use tmpfs for performance) |
| `transcoder.session_idle_timeout_sec` | `30` | Kill idle ffmpeg sessions after this many seconds |
| `integrations.tmdb_api_key` | — | TMDB API key (warning if missing — TMDB features disabled) |
| `ui.theme` | `dark` | UI theme |
| `ui.app_title` | `My Home Netflix` | Browser tab title |

## Data Directory (Jellyfin-Compatible)

```
data/                                       # /data volume
├── media.db                                # SQLite database
├── metadata/
│   └── library/                            # Per-item metadata + images
│       └── {id[:2]}/                       # Sharded by first 2 chars of media ID
│           └── {media_id}/
│               ├── poster.jpg              # Primary poster (downloaded from TMDB)
│               ├── backdrop.jpg            # Backdrop image
│               └── thumb.jpg               # Extracted thumbnail
├── images/
│   └── tmdb/                               # Shared TMDB image cache (deduplicated)
│       └── {tmdb_id}/
│           ├── poster.jpg
│           └── backdrop.jpg
├── collections/                            # Collection metadata
├── transcodes/                             # HLS output
└── extracted/                              # Embedded poster extraction cache
```

**Architecture**: Mirrors Jellyfin's data layout. Images are downloaded locally during TMDB sync and served directly from disk. No runtime dependency on `image.tmdb.org` after the first sync.

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
| `GET` | `/` | No | React SPA (embedded via go:embed) |
| `POST` | `/api/v1/auth/login` | No | Login → JWT |

### Authenticated (profile-scoped JWT)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/profiles` | List profiles for user |
| `GET` | `/api/v1/media` | Browse media (filtered by profile) |
| `GET` | `/api/v1/stream/{id}` | Direct Play stream |
| `GET` | `/api/v1/remux/{id}` | Container remux stream |
| `GET` | `/api/v1/transcode/{id}/master.m3u8` | HLS master playlist (all renditions) |
| `GET` | `/api/v1/transcode/{id}/{rest...}` | HLS segment files |
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
| `/admin/libraries` | Library CRUD |
| `/admin/tags` | Tag editor |
| `/admin/media` | Media manager |
| `/admin/collections` | Collection manager |
| `/admin/settings` | App settings |

Both the main app and admin panel are separate Vite entry points in the same React codebase, sharing the API client, CSS design tokens, and auth context.

## Prerequisites

**Docker** is all you need. The multi-stage Dockerfile builds both the React frontend (Node.js) and Go backend in one command:

```bash
docker compose up --build -d
```

For local development outside Docker:

| Tool | Minimum Version |
|---|---|
| Go | 1.22+ |
| Node.js | 20+ |
| ffmpeg + ffprobe | any recent |
| gcc | for CGO SQLite bindings |

## Development

Run outside Docker (requires Go 1.22+, Node.js 20+, ffmpeg, and gcc):

```bash
# Backend (terminal 1)
go run .

# Frontend dev server with HMR (terminal 2)
cd web && npm install && npm run dev
# → http://localhost:5173 (proxies /api to :8080)

# Production build for testing the embedded binary
cd web && npm run build       # Vite outputs to web/dist/
CGO_ENABLED=1 go build .      # Embeds dist/ into the binary
```

On startup, the server runs a full media scan and starts a filesystem watcher. New video files placed in the media directory are automatically detected, probed, and queued for 480p HLS conversion. During playback, the transcoder creates on-demand rendition ladders (360p, 480p, 720p, capped 1080p) and the hls.js player auto-adapts to the viewer's bandwidth.

## Architecture

### Backend (Go)
```
┌──────────────────────────────────────────────────────────────┐
│                      LibraryManager                          │
│  (orchestrates scan → resolve → enrich → persist)            │
├──────────────────────────────────────────────────────────────┤
│  Scanner        │  Resolver Chain  │  Provider Manager       │
│  (file walker)  │  (file→item)     │  (metadata + images)    │
│  ┌────────────┐ │  ┌─────────────┐ │  ┌──────────────────┐  │
│  │ fsnotify   │ │  │ EpisodeRes  │ │  │ TMDBProvider     │  │
│  │ ffprobe    │ │  │ MovieRes    │ │  │ EmbeddedProvider │  │
│  │ subtitles  │ │  │ NamingOpts  │ │  │ ImageCacheMgr    │  │
│  │ audio trk  │ │  │ 54 ext,     │ │  │ (download→disk)  │  │
│  │ images     │ │  │ 8 ep regex  │ │  └──────────────────┘  │
│  └────────────┘ │  └─────────────┘ │                         │
├──────────────────────────────────────────────────────────────┤
│                   Repository (SQLite)                        │
└──────────────────────────────────────────────────────────────┘
```

**Provider-Resolver pattern** mirrors Jellyfin's architecture:
- **Resolvers** determine WHAT each file is (Movie, Episode) using 54 extensions + 8 episode regex patterns
- **Providers** enrich items with metadata (TMDB) and download images locally
- **ImageCacheManager** downloads TMDB images to `data/metadata/library/{id}/` — served directly from disk
- **LibraryManager** orchestrates the scan-and-enrich pipeline

### Frontend (React + Vite)
```
web/
├── index.html                    → Main SPA entry
├── admin/index.html              → Admin panel entry
├── src/
│   ├── main.jsx                  → React root (QueryClient + AuthProvider + BrowserRouter)
│   ├── admin.jsx                 → Admin root
│   ├── App.jsx                   → Routes: /, /detail/:id, /browse/*, /watch/:id, /collections
│   ├── AdminApp.jsx              → Routes: dashboard, users, libraries, tags, media, collections, settings
│   ├── api/client.js             → Fetch wrapper (JWT, in-memory cache, dedup)
│   ├── api/admin.js              → Admin API client
│   ├── context/AuthContext.jsx   → Auth state (login/logout/role)
│   ├── components/
│   │   ├── layout/               → TopNav, BottomNav, Layout
│   │   ├── auth/                 → LoginOverlay (particle canvas)
│   │   ├── home/                 → Hero, ContentRow, MediaCard, SkeletonLoader
│   │   ├── detail/               → DetailPage, EpisodeList
│   │   ├── browse/               → FilterBar
│   │   ├── player/               → PlayerOverlay (hls.js), ControlBar, SettingsDrawer, EpisodeDrawer
│   │   └── admin/                → AdminLayout, Modal
│   └── pages/                    → HomePage, DetailPage, BrowsePage, PlayerPage, CollectionsPage
│       └── admin/                → DashboardPage, UsersPage, LibrariesPage, TagsPage, MediaPage,
│                                    CollectionsAdminPage, SettingsPage
├── dist/                         → Vite build output (embedded via go:embed)
```

Vite compiles the React app to static HTML/CSS/JS in `web/dist/`. The Go binary embeds `dist/**` at compile time and serves it via `http.FileServer`. At runtime, the React SPA takes over with client-side routing (React Router BrowserRouter) and fetches data from `/api/v1/*` endpoints.

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Go 1.22, `net/http` (Go 1.22 ServeMux), raw SQL |
| **Frontend** | React 18, React Router v6, TanStack Query v5 |
| **Bundler** | Vite 6, CSS Modules |
| **Video** | hls.js (npm), ffmpeg/ffprobe |
| **Database** | SQLite3 via `mattn/go-sqlite3`, WAL mode |
| **Auth** | JWT (golang-jwt), bcrypt |

## License

MIT
