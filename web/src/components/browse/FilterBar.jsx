import styles from './FilterBar.module.css'

export default function FilterBar({ items, selected, onChange }) {
  if (!items?.length) return null

  return (
    <div className={styles.bar}>
      <button
        className={`${styles.btn} ${selected === 'all' ? styles.active : ''}`}
        onClick={() => onChange('all')}
      >
        All
      </button>
      {items.map(lib => (
        <button
          key={lib.id}
          className={`${styles.btn} ${selected === String(lib.id) ? styles.active : ''}`}
          onClick={() => onChange(String(lib.id))}
        >
          {lib.name}
        </button>
      ))}
    </div>
  )
}
