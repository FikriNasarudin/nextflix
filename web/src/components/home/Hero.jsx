import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { backdropUrl } from '../../api/client'
import { useDetailModal } from '../../context/DetailModalContext'
import styles from './Hero.module.css'

export default function Hero({ items }) {
  const navigate = useNavigate()
  const { openDetail } = useDetailModal()
  const [index, setIndex] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!items?.length) return
    timerRef.current = setInterval(() => {
      setIndex(prev => (prev + 1) % Math.min(items.length, 8))
    }, 8000)
    return () => clearInterval(timerRef.current)
  }, [items])

  if (!items?.length) return null

  const displayItems = items.slice(0, 8)
  const item = displayItems[index]
  const bg = backdropUrl(item.backdrop_path, item.poster_path, item.id)
  const rating = item.rating || item.vote_average
  const typeLabel = item.media_type === 'tv' ? 'TV Series' : 'Movie'

  const handlePlay = () => navigate('/watch/' + item.id)
  const handleInfo = () => {
    openDetail(item)
  }

  return (
    <section className={styles.hero}>
      <div
        className={styles.backdrop}
        style={{ backgroundImage: bg ? `url(${bg})` : undefined }}
      />
      <div className={styles.content}>
        <div className={styles.badges}>
          <span className={styles.badgeFeatured}>Featured</span>
          <span className={styles.badgeGenre}>{typeLabel}</span>
          {rating && <span className={styles.badgeGenre}>{rating}</span>}
        </div>
        <h1 className={styles.title}>{item.title}</h1>
        <p className={styles.meta}>
          {typeLabel}
          {item.release_date && ` · ${(item.release_date || '').substring(0, 4)}`}
          {item.duration_seconds ? ` · ${Math.floor(item.duration_seconds / 60)}m` : ''}
        </p>
        {item.overview && <p className={styles.overview}>{item.overview}</p>}
        <div className={styles.buttons}>
          <button className={styles.btnPlay} onClick={handlePlay}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>play_arrow</span>
            Play
          </button>
          <button className={styles.btnInfo} onClick={handleInfo}>More Info</button>
        </div>
      </div>
      <div className={styles.dots}>
        {displayItems.map((_, i) => (
          <button
            key={i}
            className={`${styles.dot} ${i === index ? styles.dotActive : ''}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </section>
  )
}
