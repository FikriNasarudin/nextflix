import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import styles from './LoginOverlay.module.css'

export default function LoginOverlay() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId

    const particles = []
    function resize() {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    window.addEventListener('resize', resize)
    resize()

    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 1.5 + 0.5,
        sx: (Math.random() - 0.5) * 0.5,
        sy: (Math.random() - 0.5) * 0.5,
        opacity: Math.random() * 0.4,
      })
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of particles) {
        p.x += p.sx
        p.y += p.sy
        if (p.x < 0 || p.x > canvas.width || p.y < 0 || p.y > canvas.height) {
          p.x = Math.random() * canvas.width
          p.y = Math.random() * canvas.height
        }
        ctx.fillStyle = 'rgba(194,109,240,' + p.opacity + ')'
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
      animId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await login(username, password)
    } catch (err) {
      setError(err.message || 'Invalid credentials')
    }
  }

  return (
    <div className={styles.overlay}>
      <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />
      <form className={styles.box} onSubmit={handleSubmit}>
        <h2>Sign In</h2>
        <input
          type="text"
          placeholder="Username"
          autoComplete="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className={styles.error}>{error || '\u00A0'}</p>
        <button type="submit" className={styles.btn}>Sign In</button>
        <p className={styles.hint}>Default: admin / admin</p>
      </form>
    </div>
  )
}
