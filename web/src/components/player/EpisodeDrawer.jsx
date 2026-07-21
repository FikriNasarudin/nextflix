import { useState, useMemo } from 'react'
import { imageUrl } from '../../api/client'
import styles from './EpisodeDrawer.module.css'

export default function EpisodeDrawer({ episodes, currentId, onSelect, onClose }) {
  const [season, setSeason] = useState(() => {
    const current = episodes.find(e => e.id === currentId)
    return current?.season_number || 1
  })

  const seasons = useMemo(() => {
    const set = new Set(episodes.map(e => e.season_number || 1))
    return [...set].sort((a, b) => a - b)
  }, [episodes])

  const seasonEps = episodes
    .filter(e => (e.season_number || 1) === season)
    .sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0))

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.drawer} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span style={{ fontWeight: 600 }}>Episodes</span>
          <select
            className={styles.trackSelect}
            value={season}
            onChange={e => setSeason(Number(e.target.value))}
          >
            {seasons.map(s => (
              <option key={s} value={s}>Season {s}</option>
            ))}
          </select>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.list}>
          {seasonEps.map(ep => (
            <div
              key={ep.id}
              className={`${styles.item} ${ep.id === currentId ? styles.active : ''}`}
              onClick={() => onSelect(ep)}
            >
              <img
                className={styles.thumb}
                src={imageUrl(ep.poster_path, ep.id, 'poster', 'w185')}
                alt={ep.title}
                loading="lazy"
                onError={(e) => { e.target.style.display = 'none' }}
              />
              <div className={styles.episodeInfo}>
                <div className={styles.num}>Episode {ep.episode_number || ''}</div>
                <div className={styles.name}>{ep.title}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
