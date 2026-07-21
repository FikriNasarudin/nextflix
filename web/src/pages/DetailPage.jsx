import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { useState, useMemo } from 'react'
import { apiFetch, backdropUrl, imageUrl } from '../api/client'
import EpisodeList from '../components/detail/EpisodeList'
import ContentRow from '../components/home/ContentRow'
import styles from '../components/detail/DetailPage.module.css'

export default function DetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [selectedSeason, setSelectedSeason] = useState(1)

  const { data: allData } = useQuery({
    queryKey: ['detail', id],
    queryFn: async () => {
      const [mediaMovies, mediaTV, collections, recommendations] = await Promise.all([
        apiFetch('/media?limit=500&media_type=movie'),
        apiFetch('/media?limit=500&media_type=tv'),
        apiFetch('/collections'),
        apiFetch('/recommendations'),
      ])
      const allMedia = [...(mediaMovies?.items || []), ...(mediaTV?.items || [])]
      const item = allMedia.find(m => m.id === parseInt(id))
      return {
        item,
        allMedia,
        collections: collections || [],
        because: recommendations?.because_you_watched || [],
        similar: allMedia.filter(m => m.id !== parseInt(id)).slice(0, 12),
      }
    },
  })

  if (!allData?.item) {
    return (
      <div style={{ padding: 'var(--space-xxl)', textAlign: 'center', color: 'var(--muted)', minHeight: '60vh' }}>
        <h2>Not Found</h2>
        <button onClick={() => navigate('/')} style={{ marginTop: 16, cursor: 'pointer', padding: '8px 16px', background: 'var(--surface-container)', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', color: 'var(--text)' }}>
          Back to Home
        </button>
      </div>
    )
  }

  const { item, allMedia, similar } = allData
  const backdrop = backdropUrl(item.backdrop_path, item.poster_path, item.id)
  const poster = imageUrl(item.poster_path, item.id, 'poster', 'w500')
  const isTV = item.media_type === 'tv'
  const rating = item.rating || item.vote_average
  const year = item.release_date ? (item.release_date || '').substring(0, 4) : ''
  const duration = item.duration_seconds ? Math.floor(item.duration_seconds / 60) + 'm' : ''
  const episodes = item.episode_count ? item.episode_count + ' episodes' : ''

  const seasons = useMemo(() => {
    if (!isTV || !item.show_name) return []
    const showEpisodes = allMedia.filter(
      m => m.media_type === 'tv' && m.show_name === item.show_name
    )
    const seasonSet = new Set(showEpisodes.map(e => e.season_number || 1))
    return [...seasonSet].sort((a, b) => a - b)
  }, [isTV, item.show_name, allMedia])

  const seasonEpisodes = useMemo(() => {
    if (!isTV || !item.show_name) return []
    return allMedia.filter(
      m => m.media_type === 'tv' && m.show_name === item.show_name && (m.season_number || 1) === selectedSeason
    ).sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0))
  }, [isTV, item.show_name, selectedSeason, allMedia])

  const handlePlay = () => navigate('/watch/' + item.id)

  return (
    <div className={styles.page}>
      <div className={styles.backdrop} style={{ backgroundImage: backdrop ? `url(${backdrop})` : undefined }}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>← Back</button>
        <button className={styles.browseBtn} onClick={handlePlay}>▶ Play</button>
      </div>
      <div className={styles.body}>
        <div className={styles.layout}>
          <div className={styles.posterCol}>
            <img className={styles.poster} src={poster} alt={item.title} />
          </div>
          <div className={styles.infoCol}>
            <h1 className={styles.title}>{item.title}</h1>
            <p className={styles.meta}>
              {rating && `${rating} · `}
              {year && `${year} · `}
              {isTV ? episodes : duration}
            </p>
            {item.overview && <p className={styles.overview}>{item.overview}</p>}
            <button className={styles.playBtn} onClick={handlePlay}>
              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>play_arrow</span>
              Play
            </button>
          </div>
        </div>

        {isTV && seasons.length > 1 && (
          <div style={{ marginTop: 24 }}>
            <h3 className="f-title-md" style={{ marginBottom: 12 }}>Episodes</h3>
            <select
              className={styles.seasonSelect}
              value={selectedSeason}
              onChange={e => setSelectedSeason(Number(e.target.value))}
            >
              {seasons.map(s => (
                <option key={s} value={s}>Season {s}</option>
              ))}
            </select>
            <EpisodeList episodes={seasonEpisodes} onPlay={handlePlay} activeId={item.id} />
          </div>
        )}

        {similar.length > 0 && (
          <ContentRow
            title="More Like This"
            items={similar}
          />
        )}
      </div>
    </div>
  )
}
