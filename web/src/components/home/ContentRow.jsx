import { useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import MediaCard from './MediaCard'
import styles from './ContentRow.module.css'

export default function ContentRow({ title, items, viewAllLink, variant, showProgress, showRank }) {
  const rowRef = useRef(null)
  const navigate = useNavigate()

  const scroll = useCallback((dir) => {
    const el = rowRef.current
    if (el) el.scrollBy({ left: dir * 600, behavior: 'smooth' })
  }, [])

  const onMouseDown = useCallback((e) => {
    const el = rowRef.current
    if (!el) return
    el.style.cursor = 'grabbing'
    el.style.userSelect = 'none'
    let startX = e.pageX - el.offsetLeft
    let scrollLeft = el.scrollLeft
    const onMove = (ev) => {
      el.scrollLeft = scrollLeft - (ev.pageX - el.offsetLeft - startX)
    }
    const onUp = () => {
      el.style.cursor = ''
      el.style.removeProperty('user-select')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  if (!items?.length) return null

  if (variant === 'collection') {
    return (
      <section className={styles.rowSection}>
        <h2 className={styles.rowTitle}>
          {title}
          {viewAllLink && <span className={styles.viewAll} onClick={() => navigate(viewAllLink)}>View All →</span>}
        </h2>
        <div className={styles.rowWrapper}>
          <button className={`${styles.rowArrow} ${styles.rowArrowLeft}`} onClick={() => scroll(-1)}>‹</button>
          <div className={styles.row} ref={rowRef} onMouseDown={onMouseDown}>
            {items.map(item => (
              <MediaCard key={item.id} item={item} showProgress={showProgress} />
            ))}
          </div>
          <button className={`${styles.rowArrow} ${styles.rowArrowRight}`} onClick={() => scroll(1)}>›</button>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.rowSection}>
      <h2 className={styles.rowTitle}>
        {title}
        {viewAllLink && <span className={styles.viewAll} onClick={() => navigate(viewAllLink)}>View All →</span>}
      </h2>
      <div className={styles.rowWrapper}>
        <button className={`${styles.rowArrow} ${styles.rowArrowLeft}`} onClick={() => scroll(-1)}>‹</button>
        <div className={`${styles.row} ${showRank ? styles.rowTrending : ''}`} ref={rowRef} onMouseDown={onMouseDown}>
          {items.map((item, i) => (
            <MediaCard
              key={item.id}
              item={item}
              rank={showRank ? i + 1 : undefined}
              showProgress={showProgress}
            />
          ))}
        </div>
        <button className={`${styles.rowArrow} ${styles.rowArrowRight}`} onClick={() => scroll(1)}>›</button>
      </div>
    </section>
  )
}
