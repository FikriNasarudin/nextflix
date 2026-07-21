package scanner

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type ParsedMedia struct {
	Title         string
	ShowName      string
	SeasonNumber  int
	EpisodeNumber int
	EpisodeTitle  string
	Year          string
	TmdbID        int64
	EpisodeEnd    int
	GroupID       int64
}

var epRegex = regexp.MustCompile(`(?i)[\s._-]*[Ss](\d+)[\s._-]*[Ee](\d+)`)
var multiEpRegex = regexp.MustCompile(`(?i)[\s._-]*[Ss](\d+)[\s._-]*[Ee](\d+)[\s._-]*[-–][\s._-]*[Ee]?(\d+)`)
var altEpRegex = regexp.MustCompile(`(?i)[\s._-]*(\d+)[xX](\d+)`)
var yearRegex = regexp.MustCompile(`[.\s-]\(?(\d{4})\)?[\s.-]*$`)
var tmdbidBracket = regexp.MustCompile(`(?i)\[tmdbid[=:_]?(\d+)\]`)
var imdbidBracket = regexp.MustCompile(`(?i)\[imdbid[=:_]?(tt\d+)\]`)
var yearRe = regexp.MustCompile(`[.\s-]\(?\d{4}\)?\s*$`)
var qualityTags = []string{
	"bluray-1080p", "bluray-720p", "bluray-2160p", "bluray",
	"webdl-1080p", "web-dl-1080p", "webdl-720p", "web-dl-720p", "webdl", "web-dl",
	"hdtv-1080p", "hdtv-720p", "hdtv",
	"proper", "repack", "amzn", "nf", "webrip", "web-rip",
	"1080p", "720p", "2160p", "480p",
}

func ParseMedia(path, mediaType string, mediaDir string) ParsedMedia {
	var result ParsedMedia

	rel, err := filepath.Rel(mediaDir, path)
	if err != nil {
		result.Title = cleanFileTitle(path)
		return result
	}

	parts := splitPath(rel)
	filename := cleanFileTitle(path)
	filenameLower := strings.ToLower(filename)

	cleaned := strings.TrimSuffix(filenameLower, filepath.Ext(filenameLower))
	cleaned = stripQualityTags(cleaned)
	cleaned = strings.TrimSpace(cleaned)

	result.Year = extractYear(cleaned)

	if mediaType == "tv" {
		showName, season, episode, episodeEnd, epTitle := parseTV(parts, cleaned)
		result.ShowName = showName
		result.SeasonNumber = season
		result.EpisodeNumber = episode
		result.EpisodeEnd = episodeEnd
		result.EpisodeTitle = epTitle

		if showName != "" {
			result.Title = showName
			if episode > 0 {
				result.Title += " S" + padZero(season) + "E" + padZero(episode)
				if episodeEnd > 0 {
					result.Title += "-E" + padZero(episodeEnd)
				}
				if epTitle != "" {
					result.Title += " - " + epTitle
				}
			}
		} else {
			result.Title = titleCase(cleaned)
		}
	} else {
		result.Title = titleCase(cleaned)
	}

	if result.Title == "" {
		result.Title = cleanFileTitle(path)
	}

	return result
}

func parseTV(parts []string, cleaned string) (showName string, season, episode, episodeEnd int, epTitle string) {
	season, episode, episodeEnd = extractEpisodes(cleaned)

	cleanedNoEp := cleaned
	if season > 0 {
		pat := `(?i)[\s._-]*s` + padZero(season) + `[\s._-]*e` + padZero(episode) + `[\s._-]*(.*)`
		re := regexp.MustCompile(pat)
		if m := re.FindStringSubmatch(cleaned); len(m) > 1 {
			epTitle = strings.TrimSpace(m[1])
		}
		re2 := regexp.MustCompile(`(?i)[\s._-]*s\d+[\s._-]*e\d+.*`)
		cleanedNoEp = re2.ReplaceAllString(cleaned, "")
	}

	year := extractYear(cleanedNoEp)
	cleanedNoEp = strings.TrimSpace(yearRe.ReplaceAllString(cleanedNoEp, ""))

	var seasonDir string
	var parentDir string
	for i, p := range parts {
		lower := strings.ToLower(p)
		if strings.HasPrefix(lower, "season") || (strings.HasPrefix(lower, "s") && len(p) >= 2 && len(p) <= 4) {
			seasonDir = p
			if i > 0 {
				parentDir = parts[i-1]
			}
			break
		}
	}

	if parentDir != "" {
		cleanParent := stripQualityTags(strings.ToLower(parentDir))
		cleanParent = strings.TrimSpace(yearRe.ReplaceAllString(cleanParent, ""))
		showName = titleCase(strings.TrimSpace(cleanParent))
		parentYear := extractYear(strings.ToLower(parentDir))
		if parentYear != "" {
			year = parentYear
		}
	} else {
		showName = titleCase(strings.TrimSpace(cleanedNoEp))
	}

	if season == 0 && seasonDir != "" {
		lower := strings.ToLower(seasonDir)
		if strings.HasPrefix(lower, "season") {
			re := regexp.MustCompile(`(?i)^season\s?(\d+)`)
			if m := re.FindStringSubmatch(seasonDir); len(m) >= 2 {
				if n, err := strconv.Atoi(m[1]); err == nil {
					season = n
				}
			}
		} else {
			n, err := strconv.Atoi(strings.TrimLeft(lower, "s"))
			if err == nil {
				season = n
			}
		}
	}

	if year != "" && !strings.Contains(showName, year) {
		showName = strings.TrimSpace(showName + " (" + year + ")")
	}

	return
}

func extractEpisodes(s string) (season, episode, episodeEnd int) {
	if m := multiEpRegex.FindStringSubmatch(s); len(m) >= 4 {
		sn, _ := strconv.Atoi(m[1])
		en, _ := strconv.Atoi(m[2])
		ee, _ := strconv.Atoi(m[3])
		return sn, en, ee
	}
	if m := epRegex.FindStringSubmatch(s); len(m) >= 3 {
		sn, _ := strconv.Atoi(m[1])
		en, _ := strconv.Atoi(m[2])
		return sn, en, 0
	}
	if m := altEpRegex.FindStringSubmatch(s); len(m) >= 3 {
		sn, _ := strconv.Atoi(m[1])
		en, _ := strconv.Atoi(m[2])
		return sn, en, 0
	}
	return 0, 0, 0
}

func extractTmdbIDFromPath(path, mediaDir string, mediaType string) int64 {
	rel, err := filepath.Rel(mediaDir, path)
	if err != nil {
		return 0
	}
	parts := splitPath(rel)
	for _, p := range parts {
		if m := tmdbidBracket.FindStringSubmatch(p); len(m) >= 2 {
			id, _ := strconv.ParseInt(m[1], 10, 64)
			return id
		}
	}
	return 0
}

func extractImdbIDFromPath(path, mediaDir string) string {
	rel, err := filepath.Rel(mediaDir, path)
	if err != nil {
		return ""
	}
	parts := splitPath(rel)
	for _, p := range parts {
		if m := imdbidBracket.FindStringSubmatch(p); len(m) >= 2 {
			return m[1]
		}
	}
	return ""
}

func extractYearFromDir(dirName string) string {
	if m := yearRegex.FindStringSubmatch(dirName); len(m) >= 2 {
		year := m[1]
		if y, err := strconv.Atoi(year); err == nil && y >= 1900 && y <= 2099 {
			return year
		}
	}
	return ""
}

func extractYear(s string) string {
	if m := yearRegex.FindStringSubmatch(s); len(m) >= 2 {
		year := m[1]
		if y, err := strconv.Atoi(year); err == nil && y >= 1900 && y <= 2099 {
			return year
		}
	}
	return ""
}

func stripQualityTags(s string) string {
	lower := strings.ToLower(s)
	for _, tag := range qualityTags {
		tagLower := strings.ToLower(tag)
		idx := strings.LastIndex(lower, tagLower)
		if idx > 3 {
			trimmed := strings.TrimSpace(s[:idx])
			if len(trimmed) > 0 {
				s = trimmed
				lower = strings.ToLower(s)
			}
		}
	}
	s = strings.TrimRight(s, " .-_")
	return s
}

func cleanFileTitle(path string) string {
	base := filepath.Base(path)
	ext := filepath.Ext(base)
	return strings.TrimSuffix(base, ext)
}

func splitPath(rel string) []string {
	return strings.Split(rel, string(filepath.Separator))
}

func padZero(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}
