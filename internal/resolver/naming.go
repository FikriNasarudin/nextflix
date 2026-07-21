package resolver

import "regexp"

type EpisodePattern struct {
	Regex                           *regexp.Regexp
	IsNamed                         bool
	IsOptimistic                    bool
	SupportsAbsoluteEpisodeNumbers  bool
}

type NamingOptions struct {
	VideoFileExtensions          []string
	EpisodeExpressions           []*EpisodePattern
	SampleFilePattern            *regexp.Regexp
	CleanStrings                 []*regexp.Regexp
	MultipleEpisodeExpressions   []*regexp.Regexp
}

func DefaultNamingOptions() *NamingOptions {
	return &NamingOptions{
		VideoFileExtensions: []string{
			".001", ".3g2", ".3gp", ".amv", ".asf", ".asx", ".avi", ".bin",
			".bivx", ".divx", ".dv", ".dvr-ms", ".f4v", ".fli", ".flv", ".ifo",
			".img", ".iso", ".m2t", ".m2ts", ".m2v", ".m4v", ".mkv", ".mk3d",
			".mov", ".mp4", ".mpe", ".mpeg", ".mpg", ".mts", ".mxf", ".nrg",
			".nsv", ".nuv", ".ogg", ".ogm", ".ogv", ".pva", ".qt", ".rec",
			".rm", ".rmvb", ".strm", ".svq3", ".tp", ".ts", ".ty", ".viv",
			".vob", ".vp3", ".webm", ".wmv", ".wtv", ".xvid",
		},
		EpisodeExpressions: []*EpisodePattern{
			{
				Regex: regexp.MustCompile(`(?i).*(?:\\|/)?[Ss]([0-9]+)[ ._-]*[Ee]([0-9]+)`),
			},
			{
				Regex: regexp.MustCompile(`(?i).*(?:\\|/)?([0-9]+)[xX]([0-9]+)`),
			},
			{
				Regex: regexp.MustCompile(`(?i)[Ee]pisode ([0-9]+)`),
			},
			{
				Regex: regexp.MustCompile(`(?i)[Ss]eason.?([0-9]+)[\\/][Ee]?([0-9]+)`),
			},
			{
				Regex: regexp.MustCompile(`(?i).*[Ss](?:eason)?\s*([0-9]+)\s+[Ee](?:pisode)?\s*([0-9]+)`),
			},
			{
				Regex:      regexp.MustCompile(`(?i)(?:^|[\\/])([0-9]+)[ -]+(.+)`),
				IsOptimistic: true,
			},
			{
				Regex: regexp.MustCompile(`(?i).*(\d{4})\.(\d{2})\.(\d{2})`),
			},
			{
				Regex:                          regexp.MustCompile(`(?i).*?\[(\d+)\]`),
				SupportsAbsoluteEpisodeNumbers: true,
			},
		},
		SampleFilePattern: regexp.MustCompile(`(?i)(sample|trailer)`),
		CleanStrings: []*regexp.Regexp{
			regexp.MustCompile(`(?i)\b(1080p|2160p|720p|480p|4k|UHD|HD)\b`),
			regexp.MustCompile(`(?i)\b(BluRay|Blu-Ray|BRRip|BDRip|BD\d*)\b`),
			regexp.MustCompile(`(?i)\b(WEB-DL|WEBRip|WEB|WebHD|WEBDL)\b`),
			regexp.MustCompile(`(?i)\b(HDTV|PDTV|DSR|DVDRip|DVD|DVDSCR|R5|R[0-9]+|TC|TS|CAM|SCR|DVDR|BOOTLEG)\b`),
			regexp.MustCompile(`(?i)\b(x264|x265|H\.?264|H\.?265|HEVC|AVC|AV1|VP9|DivX|XviD)\b`),
			regexp.MustCompile(`(?i)\b(10bit|10-bit|8bit|8-bit|Hi10P|Hi444PP)\b`),
			regexp.MustCompile(`(?i)\b(AAC|AC3|DDP|EAC3|DTS(-?(HD|MA|ES|X))?|FLAC|MP3|TrueHD|Atmos|Opus)\b`),
			regexp.MustCompile(`(?i)\b(AAC5\.1|AC3-5\.1|DTS-HD|DTS-HDMA|True-HD)\b`),
			regexp.MustCompile(`(?i)\b(proper|repack|rerip|internal|limited|remastered|extended|uncut|directors[ .]?cut|DC|CE|deluxe|anniversary)\b`),
			regexp.MustCompile(`(?i)\b(AMZN|NF|HULU|DSNP|HMAX|ATVP|PCOK|ROKU|VOM)\b`),
			regexp.MustCompile(`(?i)\b(UNRATED|RATED|UNCENSORED|CENSORED|EXTENDED|THEATRICAL|SE)\b`),
		},
		MultipleEpisodeExpressions: []*regexp.Regexp{
			regexp.MustCompile(`(?i).*[Ss]([0-9]+)[ ._-]*[Ee]([0-9]+)[ ._-]*[-~][ ._-]*[Ee]?([0-9]+)`),
			regexp.MustCompile(`(?i).*([0-9]+)[xX]([0-9]+)[ ._-]*[-~][ ._-]*([0-9]+)`),
			regexp.MustCompile(`(?i)[Ee]pisode\s*([0-9]+)\s*[-~]\s*([0-9]+)`),
		},
	}
}
