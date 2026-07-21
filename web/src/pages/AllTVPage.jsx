import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState, useMemo } from 'react'
import { apiFetch } from '../api/client'
import MediaCard from '../components/home/MediaCard'
import FilterBar from '../components/browse/FilterBar'
import styles from './BrowsePage.module.css'

export default function AllTVPage() {
  const navigate = useNavigate()
  const [selectedLib, setSelectedLib] = useState('all')

  const { data: allMedia } = useQuery({
    queryKey: ['tv'],
    queryFn: async () => {
      const res = await apiFetch('/media?limit=500&media_type=tv')
      return res?.items || []
    },
  })

  const { data: libraries } = useQuery({
    queryKey: ['libraries'],
    queryFn: () => apiFetch('/libraries'),
  })

  const filtered = useMemo(() => {
    if (!allMedia) return []
    let items = allMedia
    if (selectedLib !== 'all') {
      items = items.filter(m => m.library_id === parseInt(selectedLib))
    }
    const seen = new Set()
    return items.filter(m => {
      const key = m.show_name
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [allMedia, selectedLib])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>← Back</button>
        <h1 className={styles.title}>All TV Shows</h1>
      </div>
      <FilterBar
        items={libraries || []}
        selected={selectedLib}
        onChange={setSelectedLib}
      />
      {filtered.length === 0 ? (
        <div className={styles.empty}>No TV shows found.</div>
      ) : (
        <div className={styles.grid}>
          {filtered.map(item => (
            <MediaCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
