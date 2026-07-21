import { useState, useEffect } from 'react'
import { adminFetch } from '../../api/admin'
import Modal from '../../components/admin/Modal'

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ username: '', password: '' })
  const [search, setSearch] = useState('')

  useEffect(() => {
    adminFetch('/users').then(setUsers)
  }, [])

  const openAdd = () => {
    setEditing(null)
    setForm({ username: '', password: '' })
    setShowModal(true)
  }

  const openEdit = (user) => {
    setEditing(user)
    setForm({ username: user.username, password: '' })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (editing) {
      await adminFetch('/users/' + editing.id, {
        method: 'PUT',
        body: JSON.stringify(form),
      })
    } else {
      await adminFetch('/users', {
        method: 'POST',
        body: JSON.stringify(form),
      })
    }
    setShowModal(false)
    const data = await adminFetch('/users')
    setUsers(data)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this user?')) return
    await adminFetch('/users/' + id, { method: 'DELETE' })
    setUsers(prev => prev.filter(u => u.id !== id))
  }

  const filtered = users.filter(u =>
    u.username?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>Users</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container)', color: 'var(--text)', fontSize: '.85rem' }}
          />
          <button className="btn btn-primary" onClick={openAdd}>Add User</button>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <thead>
          <tr>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem', letterSpacing: '.5px' }}>Username</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem', letterSpacing: '.5px' }}>Role</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem', letterSpacing: '.5px' }}>Created</th>
            <th style={{ padding: '12px 16px', textAlign: 'right', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem', letterSpacing: '.5px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(u => (
            <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{u.username}</td>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{u.role}</td>
              <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{u.created_at}</td>
              <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                <button className="btn btn-sm btn-outline" onClick={() => openEdit(u)} style={{ marginRight: 6 }}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(u.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && (
        <Modal
          title={editing ? 'Edit User' : 'Add User'}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Username
              <input
                type="text"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }}
              />
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Password {editing && '(leave blank to keep)'}
              <input
                type="password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }}
              />
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}
