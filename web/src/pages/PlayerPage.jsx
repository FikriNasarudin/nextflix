import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import PlayerOverlay from '../components/player/PlayerOverlay'

export default function PlayerPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { data: allMedia } = useQuery({
    queryKey: ['player-media'],
    queryFn: async () => {
      const [mediaMovies, mediaTV] = await Promise.all([
        apiFetch('/media?limit=500&media_type=movie'),
        apiFetch('/media?limit=500&media_type=tv'),
      ])
      return [...(mediaMovies?.items || []), ...(mediaTV?.items || [])]
    },
  })

  const item = (allMedia || []).find(m => m.id === parseInt(id))
  const similarItems = (allMedia || []).filter(m => m.id !== parseInt(id)).slice(0, 6)

  const handleClose = () => {
    navigate(-1)
  }

  const handleEpisodeSelect = (ep) => {
    navigate('/watch/' + ep.id, { replace: true })
  }

  if (!item) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000', color: 'var(--muted)' }}>
        Loading...
      </div>
    )
  }

  return (
    <PlayerOverlay
      item={item}
      allMedia={allMedia || []}
      similarItems={similarItems}
      onClose={handleClose}
      onEpisodeSelect={handleEpisodeSelect}
    />
  )
}
