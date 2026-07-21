package provider

import (
	"context"
	"database/sql"

	"nextflix/internal/model"
)

type MetadataResult struct {
	Title        string
	Overview     string
	Rating       string
	Year         int
	TmdbID       int64
	ImdbID       string
	Genres       []string
	PosterPath   string
	BackdropPath string
	TrailerKey   string
}

type ImageResult struct {
	URL       string
	Type      string
	LocalPath string
}

type IMetadataProvider interface {
	Name() string
	Fetch(ctx context.Context, item *model.MediaItem) (*MetadataResult, error)
}

type ImageFetchService interface {
	FetchImages(ctx context.Context, item *model.MediaItem) ([]ImageResult, error)
}

type ImageCacheManager struct {
	CacheDir     string
	MetadataDir  string
	TmdbImageDir string
	db           *sql.DB
}
