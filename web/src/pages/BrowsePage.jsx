import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import MediaCard from '../components/home/MediaCard'
import styles from './BrowsePage.module.css'

export default function BrowsePage() {
  const { section } = useParams()
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q')
  const navigate = useNavigate()

  const { data: allMedia } = useQuery({
    queryKey: ['browse', section, query],
    queryFn: async () => {
      const [mediaMovies, mediaTV] = await Promise.all([
        apiFetch('/media?limit=500&media_type=movie'),
        apiFetch('/media?limit=500&media_type=tv'),
      ])
      return [...(mediaMovies?.items || []), ...(mediaTV?.items || [])]
    },
  })

  const { data: progress } = useQuery({
    queryKey: ['progress'],
    queryFn: () => apiFetch('/progress', { skipCache: true }),
  })

  const { data: trending } = useQuery({
    queryKey: ['trending'],
    queryFn: () => apiFetch('/trending'),
    enabled: section === 'trending',
  })

  const { data: collections } = useQuery({
    queryKey: ['collections'],
    queryFn: () => apiFetch('/collections'),
    enabled: section === 'collections',
  })

  let title = ''
  let items = []

  if (section === 'search' && query) {
    title = `Search: "${query}"`
    items = (allMedia || []).filter(m => m.title?.toLowerCase().includes(query.toLowerCase()))
  } else if (section === 'continue') {
    title = 'Continue Watching'
    const progressMap = new Map()
    ;(progress || []).forEach(p => progressMap.set(p.media_id, p))
    items = (allMedia || [])
      .filter(m => {
        const p = progressMap.get(m.id)
        return p && p.position_seconds > 0 && !p.is_finished
      })
      .map(m => {
        const p = progressMap.get(m.id)
        return { ...m, progress_pct: p ? (p.position_seconds / p.duration_seconds) * 100 : 0 }
      })
  } else if (section === 'recommended') {
    title = 'Because You Watched'
    const { data } = useQuery({
      queryKey: ['recommendations'],
      queryFn: () => apiFetch('/recommendations'),
    })
    items = data?.because_you_watched || []
  } else if (section === 'new') {
    title = 'Newly Added'
    items = (allMedia || []).slice(0, 30)
  } else if (section === 'trending') {
    title = 'Daily Top 10'
    items = trending || []
  } else if (section === 'collections') {
    title = 'Collections'
    items = (collections || []).map(c => ({ ...c, poster_path: c.poster_path, title: c.name, id: c.id }))
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>← Back</button>
        <h1 className={styles.title}>{title}</h1>
      </div>
      {items.length === 0 ? (
        <div className={styles.empty}>No items found.</div>
      ) : (
        <div className={styles.grid}>
          {items.map(item => (
            <MediaCard
              key={item.id}
              item={item}
              showProgress={section === 'continue'}
              isNew={section === 'new'}
            />
          ))}
        </div>
      )}
    </div>
  )
}
