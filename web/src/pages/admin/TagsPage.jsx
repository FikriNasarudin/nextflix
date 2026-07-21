import { useState, useEffect } from 'react'
import { adminFetch } from '../../api/admin'
import Modal from '../../components/admin/Modal'

export default function TagsPage() {
  const [tags, setTags] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', tmdb_genre_id: '' })

  useEffect(() => {
    adminFetch('/tags').then(setTags)
  }, [])

  const openAdd = () => {
    setEditing(null)
    setForm({ name: '', tmdb_genre_id: '' })
    setShowModal(true)
  }

  const openEdit = (tag) => {
    setEditing(tag)
    setForm({ name: tag.name, tmdb_genre_id: tag.tmdb_genre_id || '' })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (editing) {
      await adminFetch('/tags/' + editing.id, { method: 'PUT', body: JSON.stringify(form) })
    } else {
      await adminFetch('/tags', { method: 'POST', body: JSON.stringify(form) })
    }
    setShowModal(false)
    const data = await adminFetch('/tags')
    setTags(data)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this tag?')) return
    await adminFetch('/tags/' + id, { method: 'DELETE' })
    setTags(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>Tags</h1>
        <button className="btn btn-primary" onClick={openAdd}>Add Tag</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <thead>
          <tr>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Name</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>TMDB Genre ID</th>
            <th style={{ padding: '12px 16px', textAlign: 'right', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tags.map(t => (
            <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{t.name}</td>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{t.tmdb_genre_id || '-'}</td>
              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                <button className="btn btn-sm btn-outline" onClick={() => openEdit(t)} style={{ marginRight: 6 }}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(t.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <Modal title={editing ? 'Edit Tag' : 'Add Tag'} onClose={() => setShowModal(false)} onSave={handleSave}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Name
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              TMDB Genre ID
              <input type="text" value={form.tmdb_genre_id} onChange={e => setForm({ ...form, tmdb_genre_id: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}
