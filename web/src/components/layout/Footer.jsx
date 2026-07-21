import styles from './Footer.module.css'

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <p>NextFlix &copy; {new Date().getFullYear()}</p>
    </footer>
  )
}
