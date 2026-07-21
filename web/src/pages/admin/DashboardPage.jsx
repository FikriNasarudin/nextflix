import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from '../../api/admin'

export default function DashboardPage() {
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState([])
  const [scanStatus, setScanStatus] = useState(null)
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    adminFetch('/stats').then(setStats)
    adminFetch('/activity').then(setActivity)
    adminFetch('/settings').then(data => setSettings(data?.settings || {}))

    let interval
    const poll = async () => {
      try {
        const res = await fetch('/api/v1/admin/scan/status', {
          headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') },
        })
        const data = await res.json()
        setScanStatus(data)
        if (!data.running) {
          adminFetch('/stats').then(setStats)
        }
      } catch {}
    }
    poll()
    interval = setInterval(poll, 1500)
    return () => clearInterval(interval)
  }, [])

  const triggerScan = async () => {
    await adminFetch('/scan', { method: 'POST' })
    setScanStatus({ running: true, current: 0, total: 0, library: '', last_item: '' })
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
        <div className="stat-card" style={{ background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', padding: 20, textAlign: 'center', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary)' }}>{stats?.users || 0}</div>
          <div style={{ fontSize: '.85rem', color: 'var(--muted)', marginTop: 4 }}>Users</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', padding: 20, textAlign: 'center', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary)' }}>{stats?.libraries || 0}</div>
          <div style={{ fontSize: '.85rem', color: 'var(--muted)', marginTop: 4 }}>Libraries</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', padding: 20, textAlign: 'center', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary)' }}>{stats?.movies || 0}</div>
          <div style={{ fontSize: '.85rem', color: 'var(--muted)', marginTop: 4 }}>Movies</div>
        </div>
        <div className="stat-card" style={{ background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', padding: 20, textAlign: 'center', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary)' }}>{stats?.tv_shows || 0}</div>
          <div style={{ fontSize: '.85rem', color: 'var(--muted)', marginTop: 4 }}>TV Shows</div>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: '.85rem', color: 'var(--muted)', marginBottom: 8 }}>
          Media Directory: {settings?.media_directory || 'Not set'}
        </p>
        <button className="btn btn-primary" onClick={triggerScan}>
          Scan Libraries
        </button>

        {scanStatus?.running && (
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 6, background: 'var(--surface-container)', borderRadius: 3, overflow: 'hidden' }}>
              <div
                style={{ height: '100%', width: scanStatus.total > 0 ? (scanStatus.current / scanStatus.total * 100) + '%' : '0%', background: 'var(--accent)', transition: 'width .3s ease', borderRadius: 3 }}
              />
            </div>
            <p style={{ fontSize: '.78rem', color: 'var(--on-surface-variant)', marginTop: 6 }}>
              {scanStatus.library && `${scanStatus.library}: `}{scanStatus.current}/{scanStatus.total || '...'}
              {scanStatus.last_item && ` · ${scanStatus.last_item}`}
            </p>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Recent Activity</h2>
      <div style={{ background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', padding: '0 var(--space-md)', maxHeight: 320, overflowY: 'auto', border: '1px solid rgba(255,255,255,.04)' }}>
        {activity.map(a => (
          <div key={a.id} style={{ display: 'flex', gap: 12, padding: '10px 0', fontSize: '.85rem', borderBottom: '1px solid rgba(255,255,255,.04)', alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap', fontSize: '.78rem', minWidth: 130 }}>{a.created_at}</span>
            <span style={{ color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', fontSize: '.72rem', minWidth: 60, letterSpacing: '.5px' }}>{a.type}</span>
            <span style={{ color: 'var(--text)' }}>{a.message}</span>
          </div>
        ))}
        {activity.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>No activity yet.</div>}
      </div>
    </div>
  )
}
