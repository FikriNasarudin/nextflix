package config

import (
	"fmt"
	"log"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

var placeholderAPIKeys = map[string]bool{
	"YOUR_TMDB_API_KEY_HERE": true,
	"change-me-to-a-real-key": true,
}

type Config struct {
	Server       ServerConfig       `yaml:"server"`
	Database     DatabaseConfig     `yaml:"database"`
	Scanner      ScannerConfig      `yaml:"scanner"`
	Encoder      EncoderConfig      `yaml:"encoder"`
	Integrations IntegrationsConfig `yaml:"integrations"`
	UI           UIConfig           `yaml:"ui"`
}

type ServerConfig struct {
	Port            int `yaml:"port"`
	ReadTimeoutSec  int `yaml:"read_timeout_sec"`
	WriteTimeoutSec int `yaml:"write_timeout_sec"`
}

type DatabaseConfig struct {
	Driver       string `yaml:"driver"`
	Path         string `yaml:"path"`
	BusyTimeoutMs int   `yaml:"busy_timeout_ms"`
	JournalMode  string `yaml:"journal_mode"`
	Synchronous  string `yaml:"synchronous"`
}

type ScannerConfig struct {
	MediaDir              string `yaml:"media_dir"`
	MaxConcurrentFFprobes int    `yaml:"max_concurrent_ffprobes"`
	ScanBatchSize         int    `yaml:"scan_batch_size"`
	EnableFilesystemWatcher bool `yaml:"enable_filesystem_watcher"`
}

type EncoderConfig struct {
	EnableAuto480pHLS     bool   `yaml:"enable_auto_480p_hls"`
	HLSSegmentDurationSec int    `yaml:"hls_segment_duration_sec"`
	FFmpegPreset          string `yaml:"ffmpeg_preset"`
	HLSOutputDir          string `yaml:"hls_output_dir"`
}

type IntegrationsConfig struct {
	TmdbAPIKey string `yaml:"tmdb_api_key"`
}

type UIConfig struct {
	Theme    string `yaml:"theme"`
	AppTitle string `yaml:"app_title"`
}

func Defaults() *Config {
	return &Config{
		Server: ServerConfig{
			Port:            8080,
			ReadTimeoutSec:  15,
			WriteTimeoutSec: 30,
		},
		Database: DatabaseConfig{
			Driver:       "sqlite3",
			Path:         "./data/media.db",
			BusyTimeoutMs: 5000,
			JournalMode:  "WAL",
			Synchronous:  "NORMAL",
		},
		Scanner: ScannerConfig{
			MediaDir:              "./media",
			MaxConcurrentFFprobes: 2,
			ScanBatchSize:         50,
			EnableFilesystemWatcher: true,
		},
		Encoder: EncoderConfig{
			EnableAuto480pHLS:     true,
			HLSSegmentDurationSec: 4,
			FFmpegPreset:          "ultrafast",
			HLSOutputDir:          "./data/hls",
		},
		UI: UIConfig{
			Theme:    "dark",
			AppTitle: "My Home Netflix",
		},
	}
}

func Load(path string) (*Config, error) {
	cfg := Defaults()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, fmt.Errorf("config file %s not found, using defaults: %w", path, err)
		}
		return nil, fmt.Errorf("reading config file: %w", err)
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parsing config file: %w", err)
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) validate() error {
	var errs []string

	if c.Server.Port <= 0 || c.Server.Port > 65535 {
		errs = append(errs, "server.port must be between 1 and 65535")
	}
	if c.Database.Path == "" {
		errs = append(errs, "database.path is required")
	}
	if c.Scanner.MediaDir == "" {
		errs = append(errs, "scanner.media_dir is required")
	}
	if c.Encoder.HLSOutputDir == "" {
		errs = append(errs, "encoder.hls_output_dir is required")
	}
	if c.Integrations.TmdbAPIKey == "" || placeholderAPIKeys[c.Integrations.TmdbAPIKey] {
		log.Println("[WARN] integrations.tmdb_api_key is not set — TMDB sync will be disabled")
		log.Println("[WARN] Set a valid TMDB API key in config.yaml or via the admin settings panel")
	}

	if len(errs) > 0 {
		return fmt.Errorf("config validation failed:\n  - %s", strings.Join(errs, "\n  - "))
	}
	return nil
}
