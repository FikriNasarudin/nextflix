import { useState, useEffect } from 'react'
import { adminFetch } from '../../api/admin'
import Modal from '../../components/admin/Modal'

export default function LibrariesPage() {
  const [libraries, setLibraries] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', content_type: 'movie', description: '', folder_paths: [] })
  const [directories, setDirectories] = useState([])
  const [dirSearch, setDirSearch] = useState('')

  useEffect(() => {
    adminFetch('/libraries').then(setLibraries)
    adminFetch('/directories').then(data => setDirectories(data || []))
  }, [])

  const openAdd = () => {
    setEditing(null)
    setForm({ name: '', content_type: 'movie', description: '', folder_paths: [] })
    setShowModal(true)
  }

  const openEdit = async (lib) => {
    setEditing(lib)
    setForm({
      name: lib.name || '',
      content_type: lib.content_type || 'movie',
      description: lib.description || '',
      folder_paths: lib.folder_paths || [],
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (editing) {
      await adminFetch('/libraries/' + editing.id, {
        method: 'PUT',
        body: JSON.stringify(form),
      })
    } else {
      await adminFetch('/libraries', {
        method: 'POST',
        body: JSON.stringify(form),
      })
    }
    setShowModal(false)
    const data = await adminFetch('/libraries')
    setLibraries(data)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this library?')) return
    await adminFetch('/libraries/' + id, { method: 'DELETE' })
    setLibraries(prev => prev.filter(l => l.id !== id))
  }

  const addPath = (path) => {
    if (!form.folder_paths.includes(path)) {
      setForm({ ...form, folder_paths: [...form.folder_paths, path] })
    }
  }

  const removePath = (path) => {
    setForm({ ...form, folder_paths: form.folder_paths.filter(p => p !== path) })
  }

  const filteredDirs = directories.filter(d => d.toLowerCase().includes(dirSearch.toLowerCase()))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>Libraries</h1>
        <button className="btn btn-primary" onClick={openAdd}>Add Library</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <thead>
          <tr>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Name</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Type</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Media Count</th>
            <th style={{ padding: '12px 16px', textAlign: 'right', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {libraries.map(l => (
            <tr key={l.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{l.name}</td>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{l.content_type}</td>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{l.media_count || 0}</td>
              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                <button className="btn btn-sm btn-outline" onClick={() => openEdit(l)} style={{ marginRight: 6 }}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(l.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <Modal
          title={editing ? 'Edit Library' : 'Add Library'}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Name
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Content Type
              <select value={form.content_type} onChange={e => setForm({ ...form, content_type: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }}>
                <option value="movie">Movie</option>
                <option value="tv">TV</option>
              </select>
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Description
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                rows={2}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4, resize: 'vertical' }} />
            </label>
            <div>
              <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Folder Paths</label>
              <input type="text" placeholder="Search directories..." value={dirSearch} onChange={e => setDirSearch(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8, minHeight: 8 }}>
                {form.folder_paths.map(path => (
                  <span key={path} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 'var(--radius-full)', background: 'var(--primary-container)', color: 'var(--on-primary-container)', fontSize: '.82rem', fontWeight: 500 }}>
                    {path}
                    <button onClick={() => removePath(path)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 0, opacity: .7 }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 8 }}>
                {filteredDirs.map(dir => (
                  <div key={dir} onClick={() => addPath(dir)}
                    style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 4, fontSize: '.85rem', color: 'var(--muted)', transition: 'background .15s' }}
                    onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,.04)'}
                    onMouseLeave={e => e.target.style.background = ''}
                  >{dir}</div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
