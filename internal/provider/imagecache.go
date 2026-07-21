package provider

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"nextflix/internal/model"
)

func NewImageCacheManager(metadataDir, cacheDir string, db *sql.DB) *ImageCacheManager {
	return &ImageCacheManager{
		MetadataDir:  metadataDir,
		CacheDir:     cacheDir,
		TmdbImageDir: cacheDir,
		db:           db,
	}
}

func (m *ImageCacheManager) DownloadPoster(item *model.MediaItem) error {
	tmdbID := int64(0)
	if item.TmdbID != nil {
		tmdbID = *item.TmdbID
	}
	if tmdbID == 0 || item.PosterPath == "" {
		return nil
	}

	cachePath := filepath.Join(m.tmdbCacheDir(tmdbID), "poster.jpg")
	if err := m.downloadTMDBImage(item.PosterPath, "w500", cachePath); err != nil {
		return fmt.Errorf("download poster: %w", err)
	}

	localPath := filepath.Join(m.itemImageDir(item.ID), "poster.jpg")
	if err := m.copyFile(cachePath, localPath); err != nil {
		return fmt.Errorf("copy poster: %w", err)
	}

	m.db.Exec(`INSERT OR IGNORE INTO media_images (media_id, image_type, file_path, is_primary) VALUES (?, 'poster', ?, 1)`,
		item.ID, localPath)

	log.Printf("imagecache: saved poster for media %d -> %s", item.ID, localPath)
	return nil
}

func (m *ImageCacheManager) DownloadBackdrop(item *model.MediaItem) error {
	tmdbID := int64(0)
	if item.TmdbID != nil {
		tmdbID = *item.TmdbID
	}
	if tmdbID == 0 || item.BackdropPath == "" {
		return nil
	}

	cachePath := filepath.Join(m.tmdbCacheDir(tmdbID), "backdrop.jpg")
	if err := m.downloadTMDBImage(item.BackdropPath, "w1280", cachePath); err != nil {
		return fmt.Errorf("download backdrop: %w", err)
	}

	localPath := filepath.Join(m.itemImageDir(item.ID), "backdrop.jpg")
	if err := m.copyFile(cachePath, localPath); err != nil {
		return fmt.Errorf("copy backdrop: %w", err)
	}

	m.db.Exec(`INSERT OR IGNORE INTO media_images (media_id, image_type, file_path, is_primary) VALUES (?, 'backdrop', ?, 1)`,
		item.ID, localPath)

	log.Printf("imagecache: saved backdrop for media %d -> %s", item.ID, localPath)
	return nil
}

func (m *ImageCacheManager) GetMetadataPath(id int64) string {
	return m.itemImageDir(id)
}

func (m *ImageCacheManager) itemImageDir(id int64) string {
	idStr := strconv.FormatInt(id, 10)
	prefix := idStr
	if len(idStr) >= 2 {
		prefix = idStr[:2]
	}
	return filepath.Join(m.MetadataDir, prefix, idStr)
}

func (m *ImageCacheManager) tmdbCacheDir(tmdbID int64) string {
	return filepath.Join(m.CacheDir, strconv.FormatInt(tmdbID, 10))
}

func (m *ImageCacheManager) downloadTMDBImage(tmdbPath string, size string, dest string) error {
	if _, err := os.Stat(dest); err == nil {
		return nil
	}

	tmdbPath = strings.TrimPrefix(tmdbPath, "/")
	url := fmt.Sprintf("https://image.tmdb.org/t/p/%s/%s", size, tmdbPath)
	return m.downloadAndSave(url, dest)
}

func (m *ImageCacheManager) downloadAndSave(url string, dest string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}

	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("get %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d for %s", resp.StatusCode, url)
	}

	f, err := os.Create(dest)
	if err != nil {
		return fmt.Errorf("create %s: %w", dest, err)
	}
	defer f.Close()

	if _, err := io.Copy(f, resp.Body); err != nil {
		return fmt.Errorf("write %s: %w", dest, err)
	}

	return nil
}

func (m *ImageCacheManager) copyFile(src, dest string) error {
	if src == dest {
		return nil
	}
	if _, err := os.Stat(src); os.IsNotExist(err) {
		return fmt.Errorf("source not found: %s", src)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return fmt.Errorf("mkdir dest: %w", err)
	}

	srcFile, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open src: %w", err)
	}
	defer srcFile.Close()

	destFile, err := os.Create(dest)
	if err != nil {
		return fmt.Errorf("create dest: %w", err)
	}
	defer destFile.Close()

	if _, err := io.Copy(destFile, srcFile); err != nil {
		return fmt.Errorf("copy data: %w", err)
	}

	return nil
}
