package resolver

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"nextflix/internal/model"
)

var yearInDirRe = regexp.MustCompile(`[.\s-]\(?(\d{4})\)?[\s.-]*$`)
var tmdbBracketRe = regexp.MustCompile(`(?i)\[tmdbid[=:_]?(\d+)\]`)

type MovieResolver struct {
	opts *NamingOptions
}

func NewMovieResolver(opts *NamingOptions) *MovieResolver {
	return &MovieResolver{opts: opts}
}

func (r *MovieResolver) Priority() int { return 1 }

func (r *MovieResolver) CanResolve(path string) bool { return true }

func (r *MovieResolver) Resolve(path string, mediaDir string) (*ResolveResult, error) {
	dir := filepath.Dir(path)

	dirName := filepath.Base(dir)
	if dirName == "" || dirName == "." {
		return nil, nil
	}

	year := extractYearFromDir(dirName)

	cleaned := cleanString(dirName, r.opts.CleanStrings)
	cleaned = yearInDirRe.ReplaceAllString(cleaned, "")
	cleaned = strings.TrimSpace(strings.TrimRight(cleaned, " .-_"))

	if cleaned == "" {
		return nil, nil
	}

	tmdbID := extractTmdbID(dirName)

	title := cleaned
	if year != "" {
		title = strings.TrimSpace(cleaned + " (" + year + ")")
	}

	mediaItem := &model.MediaItem{
		Title:     title,
		MediaType: "movie",
		FilePath:  path,
		Year:      year,
	}
	if tmdbID > 0 {
		mediaItem.TmdbID = &tmdbID
	}

	return &ResolveResult{
		Item:      mediaItem,
		MediaType: "movie",
		Year:      year,
		TmdbID:    tmdbID,
	}, nil
}

func extractYearFromDir(dirName string) string {
	m := yearInDirRe.FindStringSubmatch(dirName)
	if len(m) < 2 {
		return ""
	}
	year := m[1]
	if y, err := strconv.Atoi(year); err != nil || y < 1888 || y > 2099 {
		return ""
	}
	return year
}

func extractTmdbID(s string) int64 {
	m := tmdbBracketRe.FindStringSubmatch(s)
	if len(m) < 2 {
		return 0
	}
	id, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil {
		return 0
	}
	return id
}

func cleanString(s string, cleans []*regexp.Regexp) string {
	for _, re := range cleans {
		s = re.ReplaceAllString(s, "")
	}
	return strings.TrimSpace(s)
}
