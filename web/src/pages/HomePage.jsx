import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import Hero from '../components/home/Hero'
import ContentRow from '../components/home/ContentRow'
import SkeletonLoader from '../components/home/SkeletonLoader'

export default function HomePage() {
  const { data: allData, isLoading } = useQuery({
    queryKey: ['home'],
    queryFn: async () => {
      const [mediaMovies, mediaTV, progress, trending, libraries, collections, recommendations] = await Promise.all([
        apiFetch('/media?limit=500&media_type=movie'),
        apiFetch('/media?limit=500&media_type=tv'),
        apiFetch('/progress', { skipCache: true }),
        apiFetch('/trending'),
        apiFetch('/libraries'),
        apiFetch('/collections'),
        apiFetch('/recommendations'),
      ])
      const allMedia = [...(mediaMovies?.items || []), ...(mediaTV?.items || [])]
      return {
        allMedia,
        libraries: libraries || [],
        collections: collections || [],
        progress: progress || [],
        trending: trending || [],
        because: recommendations?.because_you_watched || [],
      }
    },
  })

  if (isLoading) return <SkeletonLoader />

  const { allMedia, progress, trending, because, collections } = allData || {}

  const progressMap = new Map()
  ;(progress || []).forEach(p => progressMap.set(p.media_id, p))

  const continueWatching = (allMedia || [])
    .filter(m => {
      const p = progressMap.get(m.id)
      return p && p.position_seconds > 0 && !p.is_finished
    })
    .slice(0, 15)
    .map(m => {
      const p = progressMap.get(m.id)
      return { ...m, progress_pct: p ? (p.position_seconds / p.duration_seconds) * 100 : 0 }
    })

  const heroItems = (allMedia || [])
    .filter(m => m.backdrop_path || m.poster_path)
    .map(m => ({
      ...m,
      backdrop_path: m.backdrop_path || m.poster_path,
    }))
    .slice(0, 8)

  const newlyAdded = (allMedia || []).slice(0, 15)

  const trendingWithRank = (trending || []).slice(0, 10)

  return (
    <div>
      <Hero items={heroItems} />

      {continueWatching.length > 0 && (
        <ContentRow
          title="Continue Watching"
          items={continueWatching}
          viewAllLink="/browse/continue"
          showProgress
        />
      )}

      {because?.length > 0 && (
        <ContentRow
          title="Because You Watched"
          items={because}
          viewAllLink="/browse/recommended"
        />
      )}

      {newlyAdded.length > 0 && (
        <ContentRow
          title="Newly Added"
          items={newlyAdded}
          viewAllLink="/browse/new"
        />
      )}

      {trendingWithRank.length > 0 && (
        <ContentRow
          title="Daily Top 10"
          items={trendingWithRank}
          viewAllLink="/browse/trending"
          showRank
        />
      )}

      {collections?.length > 0 && (
        <ContentRow
          title="Collections"
          items={collections.map(c => ({ ...c, poster_path: c.poster_path, title: c.name, id: c.id, media_type: 'collection' }))}
          viewAllLink="/collections"
        />
      )}
    </div>
  )
}
