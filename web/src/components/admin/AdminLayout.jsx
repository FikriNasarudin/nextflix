import styles from './AdminLayout.module.css'

const navItems = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'users', label: 'Users' },
  { key: 'libraries', label: 'Libraries' },
  { key: 'tags', label: 'Tags' },
  { key: 'media', label: 'Media' },
  { key: 'collections', label: 'Collections' },
  { key: 'settings', label: 'Settings' },
]

export default function AdminLayout({ section, onNavigate, children }) {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <a href="/" className={styles.logo}>NEXTFLIX</a>
        <nav className={styles.nav}>
          {navItems.map(item => (
            <a
              key={item.key}
              className={`${styles.navLink} ${section === item.key ? styles.active : ''}`}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <main className={styles.main}>
        {children}
      </main>
    </div>
  )
}
