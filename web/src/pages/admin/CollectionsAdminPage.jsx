import { useState, useEffect } from 'react'
import { adminFetch } from '../../api/admin'
import Modal from '../../components/admin/Modal'

export default function CollectionsAdminPage() {
  const [collections, setCollections] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', tmdb_id: '', poster_path: '', backdrop_path: '' })
  const [allMedia, setAllMedia] = useState([])
  const [searchMedia, setSearchMedia] = useState('')
  const [selectedMedia, setSelectedMedia] = useState([])

  useEffect(() => {
    adminFetch('/collections').then(setCollections)
    adminFetch('/media').then(data => setAllMedia(data || []))
  }, [])

  const openAdd = () => {
    setEditing(null)
    setForm({ name: '', tmdb_id: '', poster_path: '', backdrop_path: '' })
    setSelectedMedia([])
    setShowModal(true)
  }

  const openEdit = async (coll) => {
    setEditing(coll)
    setForm({
      name: coll.name || '',
      tmdb_id: coll.tmdb_id || '',
      poster_path: coll.poster_path || '',
      backdrop_path: coll.backdrop_path || '',
    })
    const items = await adminFetch('/collections/' + coll.id + '/items')
    setSelectedMedia((items || []).map(i => i.id))
    setShowModal(true)
  }

  const handleSave = async () => {
    if (editing) {
      await adminFetch('/collections/' + editing.id, { method: 'PUT', body: JSON.stringify(form) })
      await adminFetch('/collections/' + editing.id + '/items', { method: 'PUT', body: JSON.stringify({ media_ids: selectedMedia }) })
    } else {
      const res = await adminFetch('/collections', { method: 'POST', body: JSON.stringify(form) })
      if (res?.id) {
        await adminFetch('/collections/' + res.id + '/items', { method: 'PUT', body: JSON.stringify({ media_ids: selectedMedia }) })
      }
    }
    setShowModal(false)
    const data = await adminFetch('/collections')
    setCollections(data)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this collection?')) return
    await adminFetch('/collections/' + id, { method: 'DELETE' })
    setCollections(prev => prev.filter(c => c.id !== id))
  }

  const toggleMedia = (id) => {
    setSelectedMedia(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const filteredMedia = allMedia.filter(m =>
    m.title?.toLowerCase().includes(searchMedia.toLowerCase())
  ).slice(0, 50)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>Collections</h1>
        <button className="btn btn-primary" onClick={openAdd}>Add Collection</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <thead>
          <tr>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Name</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>TMDB ID</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Items</th>
            <th style={{ padding: '12px 16px', textAlign: 'right', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {collections.map(c => (
            <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{c.name}</td>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{c.tmdb_id || '-'}</td>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{c.item_count || 0}</td>
              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                <button className="btn btn-sm btn-outline" onClick={() => openEdit(c)} style={{ marginRight: 6 }}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(c.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <Modal title={editing ? 'Edit Collection' : 'Add Collection'} onClose={() => setShowModal(false)} onSave={handleSave}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Name
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              TMDB ID
              <input type="text" value={form.tmdb_id} onChange={e => setForm({ ...form, tmdb_id: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>

            <div>
              <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Media Items</label>
              <input type="text" placeholder="Search media..." value={searchMedia} onChange={e => setSearchMedia(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.85rem', marginTop: 4 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8, maxHeight: 150, overflowY: 'auto' }}>
                {filteredMedia.map(m => (
                  <span key={m.id}
                    onClick={() => toggleMedia(m.id)}
                    style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontSize: '.78rem', fontWeight: 500, transition: 'all .15s',
                      background: selectedMedia.includes(m.id) ? 'var(--primary-container)' : 'var(--surface-container-high)',
                      color: selectedMedia.includes(m.id) ? 'var(--on-primary-container)' : 'var(--muted)',
                    }}
                  >{m.title}</span>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
