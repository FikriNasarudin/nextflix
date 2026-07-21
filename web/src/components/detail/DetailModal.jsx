import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState, useMemo, useEffect } from 'react'
import { apiFetch, backdropUrl, imageUrl } from '../../api/client'
import { useDetailModal } from '../../context/DetailModalContext'
import EpisodeList from './EpisodeList'
import MediaCard from '../home/MediaCard'
import CastSection from './CastSection'
import styles from './DetailModal.module.css'

export default function DetailModal() {
  const { item: modalItem, closeDetail, pushDetail, goBack, hasHistory } = useDetailModal()
  const navigate = useNavigate()
  const [selectedSeason, setSelectedSeason] = useState(1)

  const isCollection = modalItem?.media_type === 'collection'

  const { data: allData } = useQuery({
    queryKey: ['detail', modalItem?.id],
    enabled: !!modalItem && !isCollection,
    queryFn: async () => {
      const [mediaMovies, mediaTV, collections, recommendations] = await Promise.all([
        apiFetch('/media?limit=500&media_type=movie'),
        apiFetch('/media?limit=500&media_type=tv'),
        apiFetch('/collections'),
        apiFetch('/recommendations'),
      ])
      const allMedia = [...(mediaMovies?.items || []), ...(mediaTV?.items || [])]
      const item = allMedia.find(m => m.id === parseInt(modalItem.id))
      return {
        item,
        allMedia,
        collections: collections || [],
        because: recommendations?.because_you_watched || [],
        similar: allMedia.filter(m => m.id !== parseInt(modalItem.id)).slice(0, 12),
      }
    },
  })

  const { data: collectionDetail } = useQuery({
    queryKey: ['collection-detail', modalItem?.id],
    enabled: !!modalItem && isCollection,
    queryFn: () => apiFetch('/collections/' + modalItem.id),
  })

  const { data: collectionItems } = useQuery({
    queryKey: ['collection-items', modalItem?.id],
    enabled: !!modalItem && isCollection,
    queryFn: () => apiFetch('/collections/' + modalItem.id + '/items'),
  })

  const { data: collectionData } = useQuery({
    queryKey: ['media-collection', modalItem?.id],
    enabled: !!modalItem && !isCollection,
    queryFn: () => apiFetch('/media/' + modalItem.id + '/collection'),
  })

  useEffect(() => {
    setSelectedSeason(1)
  }, [modalItem?.id])

  useEffect(() => {
    if (!modalItem) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [modalItem])

  const movieItem = !isCollection ? (allData?.item || modalItem) : null
  const movieAllMedia = !isCollection ? (allData?.allMedia || []) : []

  const seasons = useMemo(() => {
    if (!movieItem || movieItem?.media_type !== 'tv' || !movieItem?.show_name) return []
    const showEpisodes = movieAllMedia.filter(
      m => m.media_type === 'tv' && m.show_name === movieItem.show_name
    )
    const seasonSet = new Set(showEpisodes.map(e => e.season_number || 1))
    return [...seasonSet].sort((a, b) => a - b)
  }, [movieItem?.show_name, movieAllMedia])

  const seasonEpisodes = useMemo(() => {
    if (!movieItem || movieItem?.media_type !== 'tv' || !movieItem?.show_name) return []
    return movieAllMedia.filter(
      m => m.media_type === 'tv' && m.show_name === movieItem.show_name && (m.season_number || 1) === selectedSeason
    ).sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0))
  }, [movieItem?.show_name, selectedSeason, movieAllMedia])

  if (!modalItem) return null

  if (isCollection) {
    const colDetail = collectionDetail || modalItem
    const items = collectionItems || []
    const colBackdrop = backdropUrl(colDetail.backdrop_path, colDetail.poster_path, colDetail.id)
    const colPoster = imageUrl(colDetail.poster_path, colDetail.id, 'poster', 'w500')

    return (
      <div className={styles.overlay} onClick={closeDetail}>
        <div className={styles.modal} onClick={e => e.stopPropagation()}>
          {hasHistory && (
            <button className={styles.backBtn} onClick={goBack}>
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
          )}
          <button className={styles.closeBtn} onClick={closeDetail}>
            <span className="material-symbols-outlined">close</span>
          </button>

          <div className={styles.backdrop} style={{ backgroundImage: colBackdrop ? `url(${colBackdrop})` : undefined }} />

          <div className={styles.body}>
            <div className={styles.layout}>
              <div className={styles.posterCol}>
                <img className={styles.poster} src={colPoster} alt={colDetail.title || colDetail.name} />
              </div>
              <div className={styles.infoCol}>
                <h1 className={styles.title}>{colDetail.title || colDetail.name}</h1>
                <p className={styles.meta}>{colDetail.item_count} items</p>
                {colDetail.overview && <p className={styles.overview}>{colDetail.overview}</p>}
              </div>
            </div>

            {items.length > 0 && (
              <section className={styles.collectionSection}>
                <h3 className="f-title-md">Movies in this Collection</h3>
                <div className={styles.grid}>
                  {items.map(ci => (
                    <MediaCard key={ci.id} item={ci} onClick={pushDetail} hideTitle />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    )
  }

  const item = allData?.item || modalItem
  const allMedia = allData?.allMedia || []
  const similar = allData?.similar || []
  const mediaCollectionItems = collectionData?.items?.filter(c => c.id !== parseInt(item.id)) || []
  const backdrop = item ? backdropUrl(item.backdrop_path, item.poster_path, item.id) : ''
  const poster = item ? imageUrl(item.poster_path, item.id, 'poster', 'w500') : ''
  const isTV = item?.media_type === 'tv'
  const rating = item?.rating || item?.vote_average
  const year = item?.release_date ? item.release_date.substring(0, 4) : ''
  const duration = item?.duration_seconds ? Math.floor(item.duration_seconds / 60) + 'm' : ''
  const episodes = item?.episode_count ? item.episode_count + ' episodes' : ''

  const handlePlay = () => {
    closeDetail()
    navigate('/watch/' + item.id)
  }

  return (
    <div className={styles.overlay} onClick={closeDetail}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {hasHistory && (
          <button className={styles.backBtn} onClick={goBack}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
        )}
        <button className={styles.closeBtn} onClick={closeDetail}>
          <span className="material-symbols-outlined">close</span>
        </button>

        <div className={styles.backdrop} style={{ backgroundImage: backdrop ? `url(${backdrop})` : undefined }} />

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

          {mediaCollectionItems.length > 0 && (
            <section className={styles.collectionSection}>
              <h3 className="f-title-md">More from {collectionData.name}</h3>
              <div className={styles.grid}>
                {mediaCollectionItems.map(ci => (
                  <MediaCard key={ci.id} item={ci} onClick={pushDetail} hideTitle />
                ))}
              </div>
            </section>
          )}

          {similar.length > 0 && (
            <section className={styles.similarSection}>
              <h3 className="f-title-md">More Like This</h3>
              <div className={styles.grid}>
                {similar.map(simItem => (
                  <MediaCard key={simItem.id} item={simItem} onClick={pushDetail} hideTitle />
                ))}
              </div>
            </section>
          )}

          <CastSection mediaId={item.id} />
        </div>
      </div>
    </div>
  )
}
