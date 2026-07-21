package resolver

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"nextflix/internal/model"
)

type EpisodeResolver struct {
	opts *NamingOptions
}

func NewEpisodeResolver(opts *NamingOptions) *EpisodeResolver {
	return &EpisodeResolver{opts: opts}
}

func (r *EpisodeResolver) Priority() int { return 0 }

func (r *EpisodeResolver) CanResolve(path string) bool {
	for _, ep := range r.opts.EpisodeExpressions {
		if ep.Regex.MatchString(filepath.Base(path)) {
			return true
		}
	}
	for _, mex := range r.opts.MultipleEpisodeExpressions {
		if mex.MatchString(filepath.Base(path)) {
			return true
		}
	}
	return false
}

func (r *EpisodeResolver) Resolve(path string, mediaDir string) (*ResolveResult, error) {
	rel, err := filepath.Rel(mediaDir, path)
	if err != nil {
		return nil, err
	}

	parts := strings.Split(rel, string(filepath.Separator))
	filename := filepath.Base(path)
	ext := filepath.Ext(filename)
	cleaned := strings.TrimSuffix(filename, ext)
	cleaned = cleanString(cleaned, r.opts.CleanStrings)
	cleaned = strings.TrimSpace(cleaned)

	season, episode, episodeEnd := r.extractEpisodes(filename)

	showName := ""
	seasonFromDir := 0
	parentDir := ""

	for i, p := range parts {
		lower := strings.ToLower(p)
		if strings.HasPrefix(lower, "season") {
			seasonFromDir = parseSeasonNumber(p)
			if i > 0 {
				parentDir = parts[i-1]
			}
			break
		}
	}

	if parentDir == "" {
		for i, p := range parts {
			if i == 0 {
				continue
			}
			lower := strings.ToLower(p)
			if strings.HasPrefix(lower, "s") && len(p) >= 2 && len(p) <= 4 {
				seasonFromDir = parseSeasonNumber(p)
				if i > 0 {
					parentDir = parts[i-1]
				}
				break
			}
		}
	}

	if parentDir == "" && len(parts) >= 2 {
		parentDir = parts[len(parts)-2]
	}

	if parentDir != "" {
		cleanParent := cleanString(parentDir, r.opts.CleanStrings)
		showName = cleanStringTitle(cleanParent)
	} else {
		if season > 0 || episode > 0 {
			re := regexp.MustCompile(`(?i)[\s._-]*[Ss]\d+[\s._-]*[Ee]\d+.*`)
			noEp := re.ReplaceAllString(cleaned, "")
			noEp = strings.TrimSpace(noEp)
			if noEp != "" {
				showName = cleanStringTitle(noEp)
			}
		}
		if showName == "" {
			showName = cleanStringTitle(cleaned)
		}
	}

	if season == 0 && seasonFromDir > 0 {
		season = seasonFromDir
	}

	year := extractYearFromDir(parentDir)

	if showName == "" {
		return nil, nil
	}

	if year != "" && !strings.Contains(showName, year) {
		showName = strings.TrimSpace(showName + " (" + year + ")")
	}

	epTitle := ""
	if episode > 0 {
		pat := fmt.Sprintf(`(?i)[\s._-]*[Ss]%02d[\s._-]*[Ee]%02d[\s._-]*(.*)`, season, episode)
		re := regexp.MustCompile(pat)
		if m := re.FindStringSubmatch(cleaned); len(m) > 1 {
			epTitle = strings.TrimSpace(m[1])
		}
	}

	title := showName
	if episode > 0 {
		title += fmt.Sprintf(" S%02dE%02d", season, episode)
		if episodeEnd > 0 {
			title += fmt.Sprintf("-E%02d", episodeEnd)
		}
		if epTitle != "" {
			title += " - " + epTitle
		}
	}

	mediaItem := &model.MediaItem{
		Title:         title,
		MediaType:     "tv",
		FilePath:      path,
		ShowName:      showName,
		SeasonNumber:  season,
		EpisodeNumber: episode,
		EpisodeTitle:  epTitle,
	}

	return &ResolveResult{
		Item:          mediaItem,
		MediaType:     "tv",
		ShowName:      showName,
		SeasonNumber:  season,
		EpisodeNumber: episode,
		EpisodeEnd:    episodeEnd,
		EpisodeTitle:  epTitle,
		Year:          year,
	}, nil
}

func (r *EpisodeResolver) extractEpisodes(filename string) (season, episode, episodeEnd int) {
	for _, mex := range r.opts.MultipleEpisodeExpressions {
		if m := mex.FindStringSubmatch(filename); m != nil {
			sn := parseIntOr0(m, 1)
			en := parseIntOr0(m, 2)
			if len(m) > 3 {
				ee := parseIntOr0(m, 3)
				return sn, en, ee
			}
			return sn, en, 0
		}
	}

	for _, ep := range r.opts.EpisodeExpressions {
		if m := ep.Regex.FindStringSubmatch(filename); m != nil {
			sn := parseIntOr0(m, 1)
			en := parseIntOr0(m, 2)
			if sn == 0 && en > 0 {
				return 1, en, 0
			}
			if sn > 0 && en > 0 {
				return sn, en, 0
			}
		}
	}

	return 0, 0, 0
}

func parseIntOr0(m []string, idx int) int {
	if idx >= len(m) || m[idx] == "" {
		return 0
	}
	n, err := strconv.Atoi(m[idx])
	if err != nil {
		return 0
	}
	return n
}

func parseSeasonNumber(s string) int {
	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "season") {
		re := regexp.MustCompile(`(?i)^season\s?(\d+)`)
		if m := re.FindStringSubmatch(s); len(m) >= 2 {
			n, _ := strconv.Atoi(m[1])
			return n
		}
	}
	n, err := strconv.Atoi(strings.TrimLeft(lower, "s"))
	if err == nil && n > 0 {
		return n
	}
	return 0
}

func cleanStringTitle(s string) string {
	words := strings.Fields(s)
	if len(words) == 0 {
		return ""
	}
	for i, w := range words {
		if len(w) == 0 {
			continue
		}
		runes := []rune(w)
		words[i] = strings.ToUpper(string(runes[:1])) + strings.ToLower(string(runes[1:]))
	}
	return strings.TrimSpace(strings.Join(words, " "))
}
