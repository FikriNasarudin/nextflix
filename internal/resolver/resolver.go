package resolver

import (
	"fmt"
	"sort"

	"nextflix/internal/model"
)

type ResolveResult struct {
	Item          *model.MediaItem
	MediaType     string
	ShowName      string
	SeasonNumber  int
	EpisodeNumber int
	EpisodeEnd    int
	EpisodeTitle  string
	Year          string
	TmdbID        int64
}

type IItemResolver interface {
	Priority() int
	CanResolve(path string) bool
	Resolve(path string, mediaDir string) (*ResolveResult, error)
}

type ResolverChain struct {
	resolvers []IItemResolver
	opts     *NamingOptions
}

func NewResolverChain(opts *NamingOptions) *ResolverChain {
	chain := &ResolverChain{
		opts: opts,
		resolvers: []IItemResolver{
			NewEpisodeResolver(opts),
			NewMovieResolver(opts),
		},
	}
	sort.Slice(chain.resolvers, func(i, j int) bool {
		return chain.resolvers[i].Priority() < chain.resolvers[j].Priority()
	})
	return chain
}

func (c *ResolverChain) Resolve(path string, mediaDir string) (*ResolveResult, error) {
	if c.opts.SampleFilePattern != nil && c.opts.SampleFilePattern.MatchString(path) {
		return nil, nil
	}

	for _, resolver := range c.resolvers {
		if !resolver.CanResolve(path) {
			continue
		}
		result, err := resolver.Resolve(path, mediaDir)
		if err != nil {
			continue
		}
		if result != nil {
			return result, nil
		}
	}
	return nil, fmt.Errorf("no resolver could handle %q", path)
}
