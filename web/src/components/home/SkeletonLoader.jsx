import styles from './SkeletonLoader.module.css'

export default function SkeletonLoader() {
  return (
    <>
      <div className={styles.skeletonHero} />
      <div className={styles.skeletonRow}>
        {[...Array(5)].map((_, i) => (
          <div key={i} className={styles.skeletonCard} />
        ))}
      </div>
    </>
  )
}
