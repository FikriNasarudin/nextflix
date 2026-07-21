import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import MediaCard from '../components/home/MediaCard'
import styles from './BrowsePage.module.css'

export default function CollectionsPage() {
  const navigate = useNavigate()

  const { data: collections } = useQuery({
    queryKey: ['collections'],
    queryFn: () => apiFetch('/collections'),
  })

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>← Back</button>
        <h1 className={styles.title}>Collections</h1>
      </div>
      {!collections?.length ? (
        <div className={styles.empty}>No collections found.</div>
      ) : (
        <div className={styles.grid} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {collections.map(c => (
            <MediaCard
              key={c.id}
              item={{
                ...c,
                poster_path: c.poster_path,
                title: c.name,
                id: c.id,
                media_type: 'collection',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
