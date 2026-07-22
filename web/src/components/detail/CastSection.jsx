import { useQuery } from '@tanstack/react-query'
import { apiFetch, imageUrl } from '../../api/client'
import styles from './CastSection.module.css'

export default function CastSection({ mediaId }) {
  const { data: credits, isLoading } = useQuery({
    queryKey: ['credits', mediaId],
    queryFn: () => apiFetch('/media/' + mediaId + '/credits'),
    enabled: !!mediaId,
  })

  if (isLoading && !!mediaId) return <div className={styles.section}><h3 className="f-title-md">Cast & Crew</h3><div className={styles.row} style={{ gap: 16 }}>{Array.from({ length: 6 }).map((_, i) => <div key={i} className={styles.person}><div className={styles.avatarWrap} style={{ background: 'var(--surface-container)' }} /><div style={{ height: 12, width: 80, margin: '0 auto', background: 'var(--surface-container)', borderRadius: 4 }} /></div>)}</div></div>
  if (!credits || credits.length === 0) return null

  const cast = credits.filter(c => c.role === 'actor')
  const crew = credits.filter(c => c.role !== 'actor').slice(0, 20)

  if (cast.length === 0 && crew.length === 0) return null

  return (
    <section className={styles.section}>
      <h3 className="f-title-md">Cast & Crew</h3>

      {cast.length > 0 && (
        <div className={styles.subsection}>
          <h4 className={styles.subtitle}>Cast</h4>
          <div className={styles.row}>
            {cast.map(person => (
              <div key={person.id} className={styles.person}>
                <div className={styles.avatarWrap}>
                  {person.profile_path ? (
                    <img
                      className={styles.avatar}
                      src={imageUrl(person.profile_path, person.tmdb_person_id, 'poster', 'w185')}
                      alt={person.name}
                      loading="lazy"
                    />
                  ) : (
                    <div className={styles.avatarPlaceholder}>
                      <span className="material-symbols-outlined">person</span>
                    </div>
                  )}
                </div>
                <div className={styles.name}>{person.name}</div>
                <div className={styles.character}>{person.character}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {crew.length > 0 && (
        <div className={styles.subsection}>
          <h4 className={styles.subtitle}>Crew</h4>
          <div className={styles.row}>
            {crew.map(person => (
              <div key={person.id} className={styles.person}>
                <div className={styles.avatarWrap}>
                  {person.profile_path ? (
                    <img
                      className={styles.avatar}
                      src={imageUrl(person.profile_path, person.tmdb_person_id, 'poster', 'w185')}
                      alt={person.name}
                      loading="lazy"
                    />
                  ) : (
                    <div className={styles.avatarPlaceholder}>
                      <span className="material-symbols-outlined">person</span>
                    </div>
                  )}
                </div>
                <div className={styles.name}>{person.name}</div>
                <div className={styles.character}>{person.character}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
