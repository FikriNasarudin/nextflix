import { useNavigate } from 'react-router-dom'
import styles from './BottomNav.module.css'

export default function BottomNav() {
  const navigate = useNavigate()

  return (
    <nav className={styles.bottomNav}>
      <button className={styles.bottomNavItem} onClick={() => navigate('/')}>
        <span className={'material-symbols-outlined ' + styles.bottomNavIcon}>home</span>
        <span>Home</span>
      </button>
      <button className={styles.bottomNavItem} onClick={() => navigate('/browse/movies')}>
        <span className={'material-symbols-outlined ' + styles.bottomNavIcon}>movie</span>
        <span>Movies</span>
      </button>
      <button className={styles.bottomNavItem} onClick={() => navigate('/browse/tv')}>
        <span className={'material-symbols-outlined ' + styles.bottomNavIcon}>live_tv</span>
        <span>TV</span>
      </button>
      <button className={styles.bottomNavItem} onClick={() => navigate('/collections')}>
        <span className={'material-symbols-outlined ' + styles.bottomNavIcon}>folder</span>
        <span>Collections</span>
      </button>
    </nav>
  )
}
