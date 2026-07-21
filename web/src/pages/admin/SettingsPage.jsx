import { useState, useEffect } from 'react'
import { adminFetch } from '../../api/admin'

export default function SettingsPage() {
  const [settings, setSettings] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    adminFetch('/settings').then(data => {
      if (data) setSettings(data)
    })
  }, [])

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    const filtered = Object.fromEntries(
      Object.entries(settings).filter(([k]) => !k.toLowerCase().includes('jwt') && !k.toLowerCase().includes('secret'))
    )
    await adminFetch('/settings', { method: 'PUT', body: JSON.stringify(filtered) })
    setSaving(false)
  }

  const entries = Object.entries(settings)
    .filter(([k]) => !k.toLowerCase().includes('jwt') && !k.toLowerCase().includes('secret'))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>Settings</h1>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No editable settings found.</div>
      ) : (
        <div style={{ maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {entries.map(([key, value]) => (
            <label key={key} style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              {key}
              <input
                type="text"
                value={value || ''}
                onChange={e => handleChange(key, e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
