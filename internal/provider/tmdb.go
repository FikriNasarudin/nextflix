package provider

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"

	"nextflix/internal/model"
)

type TMDBProvider struct {
	db         *sql.DB
	apiKey     string
	client     *http.Client
	imageCache *ImageCacheManager
}

type tmdbSearchResult struct {
	Results []struct {
		ID           int64  `json:"id"`
		Title        string `json:"title"`
		Name         string `json:"name"`
		ReleaseDate  string `json:"release_date"`
		FirstAirDate string `json:"first_air_date"`
	} `json:"results"`
}

type tmdbDetail struct {
	ID           int64   `json:"id"`
	Title        string  `json:"title"`
	Name         string  `json:"name"`
	Overview     string  `json:"overview"`
	PosterPath   string  `json:"poster_path"`
	BackdropPath string  `json:"backdrop_path"`
	ImdbID       string  `json:"imdb_id"`
	ReleaseDate  string  `json:"release_date"`
	FirstAirDate string  `json:"first_air_date"`
	VoteAverage  float64 `json:"vote_average"`
	Genres       []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	} `json:"genres"`
}

type tmdbVideos struct {
	Results []struct {
		Key      string `json:"key"`
		Site     string `json:"site"`
		Type     string `json:"type"`
		Official bool   `json:"official"`
	} `json:"results"`
}

func NewTMDBProvider(db *sql.DB, apiKey string, imageCache *ImageCacheManager) *TMDBProvider {
	return &TMDBProvider{
		db:         db,
		apiKey:     apiKey,
		client:     &http.Client{},
		imageCache: imageCache,
	}
}

func (p *TMDBProvider) Name() string { return "tmdb" }

func (p *TMDBProvider) Fetch(ctx context.Context, item *model.MediaItem) (*MetadataResult, error) {
	tmdbID := int64(0)
	if item.TmdbID != nil {
		tmdbID = *item.TmdbID
	}

	if tmdbID == 0 {
		searchTitle := item.Title
		year := 0
		if item.Year != "" {
			year, _ = strconv.Atoi(item.Year)
		}
		mediaType := item.MediaType
		if mediaType != "movie" && mediaType != "tv" {
			mediaType = "movie"
		}

		searchedID, err := p.searchTMDB(ctx, searchTitle, year, mediaType)
		if err != nil {
			return nil, fmt.Errorf("search tmdb: %w", err)
		}
		tmdbID = searchedID
	}

	if tmdbID == 0 {
		return nil, fmt.Errorf("no tmdb id found for %q", item.Title)
	}

	mediaType := item.MediaType
	if mediaType != "movie" && mediaType != "tv" {
		mediaType = "movie"
	}

	detail, err := p.fetchDetail(ctx, tmdbID, mediaType)
	if err != nil {
		return nil, fmt.Errorf("fetch detail: %w", err)
	}

	title := detail.Title
	if title == "" {
		title = detail.Name
	}

	rating := ""
	if detail.VoteAverage > 0 {
		rating = fmt.Sprintf("%.1f", detail.VoteAverage)
	}

	year := 0
	if d := detail.date(); d != "" && len(d) >= 4 {
		year, _ = strconv.Atoi(d[:4])
	}

	var genres []string
	for _, g := range detail.Genres {
		genres = append(genres, g.Name)
	}

	var trailerKey string
	videosPath := fmt.Sprintf("/%s/%d/videos", tmdbMediaTypePath(mediaType), tmdbID)
	var vv tmdbVideos
	if err := p.get(ctx, videosPath, &vv); err == nil {
		for _, v := range vv.Results {
			if v.Site == "YouTube" && v.Type == "Trailer" && v.Official {
				trailerKey = v.Key
				break
			}
		}
		if trailerKey == "" {
			for _, v := range vv.Results {
				if v.Site == "YouTube" && v.Type == "Trailer" {
					trailerKey = v.Key
					break
				}
			}
		}
	}

	result := &MetadataResult{
		Title:        title,
		Overview:     detail.Overview,
		Rating:       rating,
		Year:         year,
		TmdbID:       tmdbID,
		ImdbID:       detail.ImdbID,
		Genres:       genres,
		PosterPath:   detail.PosterPath,
		BackdropPath: detail.BackdropPath,
		TrailerKey:   trailerKey,
	}

	if p.imageCache != nil && tmdbID > 0 {
		cachedItem := &model.MediaItem{
			ID:           item.ID,
			TmdbID:       &tmdbID,
			PosterPath:   detail.PosterPath,
			BackdropPath: detail.BackdropPath,
		}
		if detail.PosterPath != "" {
			if err := p.imageCache.DownloadPoster(cachedItem); err != nil {
				log.Printf("tmdb: download poster for %q: %v", item.Title, err)
			}
		}
		if detail.BackdropPath != "" {
			if err := p.imageCache.DownloadBackdrop(cachedItem); err != nil {
				log.Printf("tmdb: download backdrop for %q: %v", item.Title, err)
			}
		}
	}

	return result, nil
}

func (d *tmdbDetail) date() string {
	if d.ReleaseDate != "" {
		return d.ReleaseDate
	}
	return d.FirstAirDate
}

func (p *TMDBProvider) searchTMDB(ctx context.Context, title string, year int, mediaType string) (int64, error) {
	query := url.QueryEscape(title)
	path := fmt.Sprintf("/search/%s?query=%s", tmdbMediaTypePath(mediaType), query)
	if year > 0 {
		yearParam := "year"
		if mediaType == "tv" {
			yearParam = "first_air_date_year"
		}
		path += fmt.Sprintf("&%s=%d", yearParam, year)
	}

	var result tmdbSearchResult
	if err := p.get(ctx, path, &result); err != nil {
		return 0, err
	}

	if len(result.Results) > 0 {
		return result.Results[0].ID, nil
	}
	return 0, fmt.Errorf("no tmdb results for %s", title)
}

func (p *TMDBProvider) fetchDetail(ctx context.Context, tmdbID int64, mediaType string) (*tmdbDetail, error) {
	path := fmt.Sprintf("/%s/%d", tmdbMediaTypePath(mediaType), tmdbID)
	var detail tmdbDetail
	if err := p.get(ctx, path, &detail); err != nil {
		return nil, err
	}
	return &detail, nil
}

func (p *TMDBProvider) get(ctx context.Context, path string, target interface{}) error {
	baseURL := "https://api.themoviedb.org/3"
	fullURL := baseURL + path

	parsed, err := url.Parse(fullURL)
	if err != nil {
		return fmt.Errorf("parse url: %w", err)
	}

	q := parsed.Query()
	q.Set("api_key", p.apiKey)
	parsed.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, "GET", parsed.String(), nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("http get: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("tmdb status=%d body=%s", resp.StatusCode, string(body))
	}

	return json.NewDecoder(resp.Body).Decode(target)
}

func (p *TMDBProvider) DownloadImage(ctx context.Context, tmdbPath string, size string, dest string) error {
	if tmdbPath == "" {
		return fmt.Errorf("empty tmdb image path")
	}

	imageURL := fmt.Sprintf("https://image.tmdb.org/t/p/%s%s", size, tmdbPath)
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", imageURL, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("download image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("image download status=%d", resp.StatusCode)
	}

	f, err := os.Create(dest)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	if _, err := io.Copy(f, resp.Body); err != nil {
		return fmt.Errorf("write image: %w", err)
	}

	return nil
}

func tmdbMediaTypePath(t string) string {
	if t == "movie" {
		return "movie"
	}
	return "tv"
}


