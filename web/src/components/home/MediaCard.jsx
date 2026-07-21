import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { imageUrl } from '../../api/client'
import { useDetailModal } from '../../context/DetailModalContext'
import styles from './MediaCard.module.css'

export default function MediaCard({ item, rank, showProgress, isNew, hideTitle }) {
  const navigate = useNavigate()
  const { openDetail } = useDetailModal()
  const [expanded, setExpanded] = useState(false)
  const expandTimer = useRef(null)
  const trailerTimer = useRef(null)
  const cardRef = useRef(null)

  useEffect(() => {
    return () => {
      clearTimeout(expandTimer.current)
      clearTimeout(trailerTimer.current)
    }
  }, [])

  const poster = imageUrl(item.poster_path, item.id, 'poster', 'w342')
  const rating = item.rating || item.vote_average
  const year = item.release_date ? (item.release_date || '').substring(0, 4) : ''
  const duration = item.duration_seconds ? Math.floor(item.duration_seconds / 60) + 'm' : ''
  const episodes = item.episode_count ? item.episode_count + ' eps' : ''

  const handleMouseEnter = () => {
    expandTimer.current = setTimeout(() => setExpanded(true), 500)
    if (item.trailer_youtube_id) {
      trailerTimer.current = setTimeout(() => setExpanded(true), 800)
    }
  }

  const handleMouseLeave = () => {
    clearTimeout(expandTimer.current)
    clearTimeout(trailerTimer.current)
    setExpanded(false)
  }

  const handleClick = () => {
    openDetail(item)
  }

  const handlePlay = (e) => {
    e.stopPropagation()
    navigate('/watch/' + item.id)
  }

  const cardClass = `${styles.card} ${expanded ? styles.cardExpanded : ''}`

  return (
    <div
      ref={cardRef}
      className={cardClass}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {rank && <div className={styles.rank}>{rank}</div>}
      {isNew && <div className={styles.badgeNew}>NEW</div>}
      {item.has_hls && <div className={styles.badgeHls}>4K</div>}
      {rating && <div className={styles.rating}>{rating}</div>}
      {(year || duration || episodes) && (
        <div className={styles.info}>{[year, duration, episodes].filter(Boolean).join(' · ') || '\u00A0'}</div>
      )}
      <img
        className={styles.poster}
        src={poster}
        alt={item.title}
        loading="lazy"
        onError={(e) => {
          e.target.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="300" height="450" fill="#1a1a2e"/><text x="150" y="230" fill="#9a8c9d" font-family="sans-serif" font-size="11" text-anchor="middle">No Poster</text></svg>')
        }}
      />

      <div className={styles.overlay}>
        <div className={styles.playIcon}>
          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>play_arrow</span>
        </div>
      </div>

      {showProgress && item.progress_pct > 0 && (
        <div className={styles.progress}>
          <div className={styles.progressFill} style={{ width: item.progress_pct + '%' }} />
        </div>
      )}

      {expanded && (
        <div className={styles.hoverContent}>
          <div className={styles.hoverActions}>
            <button className={styles.hoverActionPlay} onClick={handlePlay}>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>play_arrow</span>
            </button>
            <button className={styles.hoverAction}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
            </button>
            <button className={styles.hoverAction}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>thumb_up</span>
            </button>
          </div>
          <div className={styles.hoverMeta}>
            {rating && <span className={styles.match}>{Math.round(rating * 10)}% Match</span>}
            <span className={styles.hd}>{item.has_hls ? '4K' : 'HD'}</span>
            {episodes && <span>{episodes}</span>}
          </div>
          {item.tag_names?.length > 0 && (
            <div className={styles.hoverGenres}>
              {item.tag_names.slice(0, 3).map((tag, i) => (
                <span key={i} className={styles.hoverGenre}>
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {!expanded && !hideTitle && <div className={styles.title}>{item.title}</div>}
    </div>
  )
}
