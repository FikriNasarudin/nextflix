package model

type User struct {
	ID           int64  `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
	Role         string `json:"role"`
	IsActive     bool   `json:"is_active"`
	CreatedAt    string `json:"created_at"`
}

type Profile struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	IsKid     bool   `json:"is_kid"`
	MaxRating string `json:"max_rating"`
	CreatedAt string `json:"created_at"`
}

type Library struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	MediaType   string   `json:"media_type"`
	FolderPaths []string `json:"folder_paths"`
	CreatedAt   string   `json:"created_at"`
}

type Tag struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	TmdbGenreID *int64 `json:"tmdb_genre_id"`
}

type MediaItem struct {
	ID               int64   `json:"id"`
	LibraryID        *int64  `json:"library_id"`
	Title            string  `json:"title"`
	MediaType        string  `json:"media_type"`
	TmdbID           *int64  `json:"tmdb_id"`
	Rating           string  `json:"rating"`
	FilePath         string  `json:"-"`
	DurationSeconds  int     `json:"duration_seconds"`
	TrailerYoutubeID string  `json:"trailer_youtube_id"`
	BackdropPath     string  `json:"backdrop_path"`
	PosterPath       string  `json:"poster_path"`
	ShowName         string  `json:"show_name"`
	SeasonNumber     int     `json:"season_number"`
	EpisodeNumber    int     `json:"episode_number"`
	EpisodeTitle     string  `json:"episode_title"`
	Year             string  `json:"year"`
	Overview         string  `json:"overview"`
	EnrichStatus     string  `json:"enrich_status"`
	LastEnrichedAt   string  `json:"last_enriched_at"`
	EnrichError      string  `json:"enrich_error"`
	ResolveAttempts  int     `json:"resolve_attempts"`
	CreatedAt        string  `json:"created_at"`
}

type PlaybackProgress struct {
	ProfileID      int64  `json:"profile_id"`
	MediaID        int64  `json:"media_id"`
	PositionSec    int    `json:"position_seconds"`
	IsFinished     bool   `json:"is_finished"`
	UpdatedAt      string `json:"updated_at"`
}

type WatchHistoryEntry struct {
	ID              int64  `json:"id"`
	ProfileID       int64  `json:"profile_id"`
	MediaID         int64  `json:"media_id"`
	WatchedSec      int    `json:"watched_seconds"`
	DurationSec     int    `json:"duration_seconds"`
	IsCompleted     bool   `json:"is_completed"`
	WatchedAt       string `json:"watched_at"`
}

type Recommendation struct {
	MediaID       int64   `json:"media_id"`
	Section       string  `json:"section"`
	Score         float64 `json:"score"`
	RefreshedAt   string  `json:"refreshed_at"`
}

type TrendingItem struct {
	TmdbID     int64  `json:"tmdb_id"`
	Title      string `json:"title"`
	PosterPath string `json:"poster_path"`
	MediaType  string `json:"media_type"`
	Rank       int    `json:"rank"`
	UpdatedAt  string `json:"updated_at"`
}

type Setting struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}
