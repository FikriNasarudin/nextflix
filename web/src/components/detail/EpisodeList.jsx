import { imageUrl } from '../../api/client'
import styles from './EpisodeList.module.css'

export default function EpisodeList({ episodes, onPlay, activeId }) {
  if (!episodes?.length) return null

  return (
    <div className={styles.list}>
      {episodes.map(ep => (
        <div
          key={ep.id}
          className={`${styles.item} ${ep.id === activeId ? styles.active : ''}`}
          onClick={() => onPlay?.(ep)}
        >
          <img
            className={styles.thumb}
            src={imageUrl(ep.poster_path, ep.id, 'poster', 'w185')}
            alt={ep.title}
            loading="lazy"
            onError={(e) => { e.target.style.display = 'none' }}
          />
          <div className={styles.info}>
            <div className={styles.num}>
              Episode {ep.episode_number || ''}
              {ep.duration_seconds ? ` · ${Math.floor(ep.duration_seconds / 60)}m` : ''}
            </div>
            <div className={styles.name}>{ep.title}</div>
            {ep.overview && <div className={styles.desc}>{ep.overview}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
