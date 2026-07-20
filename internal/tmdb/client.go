package tmdb

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

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

func (c *Client) apiKey() (string, error) {
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
	key, err := c.apiKey()
	if err != nil {
		return err
	}

	<-c.rate.C

	url := c.baseURL + path
	if strings.ContainsRune(path, '?') {
		url += "&api_key=" + key
	} else {
		url += "?api_key=" + key
	}

	resp, err := http.Get(url)
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
