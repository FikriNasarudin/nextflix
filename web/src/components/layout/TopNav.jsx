import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import styles from './TopNav.module.css'

export default function TopNav() {
  const { profiles, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const [searchValue, setSearchValue] = useState('')
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handle = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', handle, { passive: true })
    return () => window.removeEventListener('scroll', handle)
  }, [])

  const handleSearch = (e) => {
    if (e.key === 'Enter' && searchValue.trim()) {
      navigate('/browse/search?q=' + encodeURIComponent(searchValue.trim()))
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const profileName = profiles[0]?.name || 'User'
  const profileInitial = profileName.charAt(0).toUpperCase()

  return (
    <nav className={`${styles.nav} ${scrolled ? styles.navScrolled : ''}`}>
      <div className={styles.navInner}>
        <a href="/" className={styles.logo}>NEXTFLIX</a>
        <div className={styles.navLinks}>
          <button className={styles.navLink} onClick={() => navigate('/')}>Home</button>
          <button className={styles.navLink} onClick={() => navigate('/browse/movies')}>Movies</button>
          <button className={styles.navLink} onClick={() => navigate('/browse/tv')}>TV Shows</button>
          <button className={styles.navLink} onClick={() => navigate('/collections')}>Collections</button>
          {isAdmin && (
            <a className={styles.navLink} href="/admin/index.html">Admin</a>
          )}
        </div>
        <div className={styles.navRight}>
          <div className={styles.navSearch}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--muted)' }}>search</span>
            <input
              type="text"
              placeholder="Titles, genres..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={handleSearch}
            />
          </div>
          <button className={styles.navIconBtn + ' material-symbols-outlined'} title="Notifications">notifications</button>
          <div className={styles.navAvatar}>
            <div className={styles.navAvatarInner}>{profileInitial}</div>
          </div>
          <span className={styles.navProfile}>{profileName}</span>
          <button className={styles.navLink} onClick={handleLogout}>Sign Out</button>
        </div>
      </div>
    </nav>
  )
}
