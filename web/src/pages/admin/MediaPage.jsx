import { useState, useEffect } from 'react'
import { adminFetch } from '../../api/admin'
import Modal from '../../components/admin/Modal'

export default function MediaPage() {
  const [media, setMedia] = useState([])
  const [allMedia, setAllMedia] = useState([])
  const [libraries, setLibraries] = useState([])
  const [tags, setTags] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ title: '', library_id: '', rating: '', tag_ids: [] })
  const [search, setSearch] = useState('')

  useEffect(() => {
    adminFetch('/media').then(setAllMedia)
    adminFetch('/libraries').then(setLibraries)
    adminFetch('/tags').then(setTags)
  }, [])

  useEffect(() => {
    setMedia(allMedia)
  }, [allMedia])

  const openEdit = async (item) => {
    const mediaTags = await adminFetch('/media/' + item.id + '/tags')
    setEditing(item)
    setForm({
      title: item.title || '',
      library_id: String(item.library_id || ''),
      rating: item.rating || '',
      tag_ids: (mediaTags || []).map(t => t.id),
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    await adminFetch('/media/' + editing.id, { method: 'PUT', body: JSON.stringify(form) })
    await adminFetch('/media/' + editing.id + '/tags', { method: 'PUT', body: JSON.stringify({ tag_ids: form.tag_ids }) })
    setShowModal(false)
    const data = await adminFetch('/media')
    setAllMedia(data)
  }

  const toggleTag = (tagId) => {
    setForm(prev => ({
      ...prev,
      tag_ids: prev.tag_ids.includes(tagId)
        ? prev.tag_ids.filter(id => id !== tagId)
        : [...prev.tag_ids, tagId],
    }))
  }

  const filtered = media.filter(m =>
    m.title?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>Media</h1>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container)', color: 'var(--text)', fontSize: '.85rem' }}
        />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <thead>
          <tr>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Title</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Type</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Rating</th>
            <th style={{ padding: '12px 16px', textAlign: 'right', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 100).map(m => (
            <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{m.title}</td>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{m.media_type}</td>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{m.rating || '-'}</td>
              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                <button className="btn btn-sm btn-outline" onClick={() => openEdit(m)}>Edit</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <Modal title="Edit Media" onClose={() => setShowModal(false)} onSave={handleSave}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Title
              <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Library
              <select value={form.library_id} onChange={e => setForm({ ...form, library_id: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }}>
                <option value="">None</option>
                {libraries.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Rating
              <input type="text" value={form.rating} onChange={e => setForm({ ...form, rating: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>
            <div>
              <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Tags</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {tags.map(t => (
                  <span key={t.id}
                    onClick={() => toggleTag(t.id)}
                    style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 'var(--radius-full)', cursor: 'pointer', fontSize: '.82rem', fontWeight: 500, transition: 'all .15s',
                      background: form.tag_ids.includes(t.id) ? 'var(--primary-container)' : 'var(--surface-container-high)',
                      color: form.tag_ids.includes(t.id) ? 'var(--on-primary-container)' : 'var(--muted)',
                    }}
                  >{t.name}</span>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
