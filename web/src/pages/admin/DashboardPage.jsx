import { useState, useEffect } from 'react'
import { adminFetch } from '../../api/admin'

function EnrichmentBar({ label, current, total }) {
  const pct = total > 0 ? Math.round(current / total * 100) : 0
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem', marginBottom: 3 }}>
        <span style={{ color: 'var(--muted)' }}>{label}</span>
        <span style={{ color: 'var(--text)' }}>{current}/{total} ({pct}%)</span>
      </div>
      <div style={{ height: 5, background: 'var(--surface-container)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: pct === 100 ? 'var(--accent)' : 'var(--primary)', transition: 'width .3s ease', borderRadius: 3 }} />
      </div>
    </div>
  )
}

function EnrichmentCard({ title, data }) {
  if (!data || !data.total) return null
  return (
    <div style={{ background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', padding: 16, border: '1px solid rgba(255,255,255,.04)' }}>
      <h3 style={{ fontSize: '.9rem', fontWeight: 600, marginBottom: 12 }}>{title}</h3>
      <EnrichmentBar label="TMDB ID" current={data.with_tmdb_id} total={data.total} />
      <EnrichmentBar label="Poster" current={data.with_poster} total={data.total} />
      <EnrichmentBar label="Overview" current={data.with_overview} total={data.total} />
    </div>
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState([])
  const [scanStatus, setScanStatus] = useState(null)
  const [settings, setSettings] = useState(null)
  const [runningAction, setRunningAction] = useState(null)

  useEffect(() => {
    adminFetch('/stats').then(setStats)
    adminFetch('/activity').then(setActivity)
    adminFetch('/settings').then(data => setSettings(data?.settings || {}))

    let interval
    const poll = async () => {
      try {
        const [scanData, statsData] = await Promise.all([
          fetch('/api/v1/admin/scan/status', {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') },
          }).then(r => r.json()),
          adminFetch('/stats'),
        ])
        setScanStatus(scanData)
        if (statsData) setStats(statsData)
        if (!scanData.running) {
          setRunningAction(null)
        }
      } catch {}
    }
    poll()
    interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [])

  const triggerScan = async () => {
    setRunningAction('scan')
    await adminFetch('/scan', { method: 'POST' })
    setScanStatus({ running: true, current: 0, total: 0, library: '', last_item: '' })
  }

  const triggerRefresh = async () => {
    setRunningAction('refresh')
    await adminFetch('/refresh-metadata', { method: 'POST' })
  }

  const triggerSync = async () => {
    setRunningAction('sync')
    await adminFetch('/sync-tmdb', { method: 'POST' })
  }

  const me = stats?.media

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
        <EnrichmentCard title="Movies Enrichment" data={me?.movies_enrichment} />
        <EnrichmentCard title="TV Shows Enrichment" data={me?.tv_enrichment} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: '.85rem', color: 'var(--muted)', marginBottom: 8 }}>
          Media Directory: {settings?.media_directory || 'Not set'}
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={triggerScan} disabled={!!runningAction}>
            {runningAction === 'scan' ? 'Scanning...' : 'Scan Libraries'}
          </button>
          <button className="btn btn-primary" onClick={triggerRefresh} disabled={!!runningAction} style={{ background: 'var(--accent)' }}>
            {runningAction === 'refresh' ? 'Refreshing...' : 'Refresh Metadata'}
          </button>
          <button className="btn btn-primary" onClick={triggerSync} disabled={!!runningAction}>
            {runningAction === 'sync' ? 'Syncing...' : 'Full TMDB Sync'}
          </button>
        </div>

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
