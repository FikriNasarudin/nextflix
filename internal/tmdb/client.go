package tmdb

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var defaultHTTPClient = &http.Client{Timeout: 30 * time.Second}

func HTTPClient() *http.Client {
	return defaultHTTPClient
}

type Client struct {
	db      *sql.DB
	baseURL string
	rate    *time.Ticker
	apiKeyCache string
	apiKeyCacheTime time.Time
}

func NewClient(db *sql.DB) *Client {
	return &Client{
		db:      db,
		baseURL: "https://api.themoviedb.org/3",
		rate:    time.NewTicker(1 * time.Second),
	}
}

func (c *Client) APIKey() (string, error) {
	if c.apiKeyCache != "" && time.Since(c.apiKeyCacheTime) < 5*time.Minute {
		return c.apiKeyCache, nil
	}
	var key string
	err := c.db.QueryRow(`SELECT value FROM settings WHERE key = 'tmdb_api_key'`).Scan(&key)
	if err != nil {
		return "", fmt.Errorf("reading tmdb_api_key: %w", err)
	}
	if key == "" || key == "YOUR_TMDB_API_KEY_HERE" || key == "change-me-to-a-real-key" {
		c.apiKeyCache = ""
		return "", fmt.Errorf("tmdb_api_key is a placeholder")
	}
	c.apiKeyCache = key
	c.apiKeyCacheTime = time.Now()
	return key, nil
}

func (c *Client) Get(path string, result any) error {
	return c.GetContext(context.Background(), path, result)
}

func (c *Client) GetContext(ctx context.Context, path string, result any) error {
	key, err := c.APIKey()
	if err != nil {
		return err
	}

	select {
	case <-c.rate.C:
	case <-ctx.Done():
		return ctx.Err()
	}

	url := c.baseURL + path
	if strings.ContainsRune(path, '?') {
		url += "&api_key=" + key
	} else {
		url += "?api_key=" + key
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := defaultHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("http get %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("tmdb %s: status=%d body=%s", path, resp.StatusCode, string(body))
	}

	return json.NewDecoder(resp.Body).Decode(result)
}
