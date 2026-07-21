import { useState, useEffect, Fragment } from 'react'
import { adminFetch } from '../../api/admin'
import Modal from '../../components/admin/Modal'

const statusColor = {
  completed: 'var(--accent)',
  in_progress: 'var(--primary)',
  queued: 'var(--tertiary-container)',
  failed: '#e50914',
  pending: 'var(--muted)',
}

function StatusPill({ status }) {
  const label = status === 'in_progress' ? 'encoding' : status === 'pending' ? 'not queued' : status
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 'var(--radius-full)',
      fontSize: '.72rem',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '.4px',
      background: statusColor[status] || 'var(--muted)',
      color: status === 'completed' || status === 'failed' ? '#fff' : 'var(--bg)',
    }}>{label}</span>
  )
}

function StreamRow({ item, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: '.82rem' }}>
      {children}
    </div>
  )
}

function MediaDetail({ mediaId }) {
  const [streams, setStreams] = useState(null)
  const [optim, setOptim] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [s, o] = await Promise.all([
      adminFetch('/media/' + mediaId + '/streams'),
      adminFetch('/media/' + mediaId + '/optimization'),
    ])
    setStreams(s)
    setOptim(o)
  }

  useEffect(() => { load() }, [mediaId])

  const triggerReencode = async () => {
    setBusy(true)
    await adminFetch('/media/' + mediaId + '/re-encode', { method: 'POST' })
    setBusy(false)
    load()
  }

  const primaryVideo = streams?.video?.find(v => v.is_default) || streams?.video?.[0]

  return (
    <div style={{ padding: '12px 24px 20px', background: 'var(--surface-container-low)', borderTop: '1px dashed rgba(255,255,255,.06)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 10 }}>

        <div>
          <h4 style={{ fontSize: '.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 8 }}>Video</h4>
          {primaryVideo ? (
            <div style={{ fontSize: '.82rem', color: 'var(--text)' }}>
              <div><strong>{primaryVideo.codec.toUpperCase()}</strong> · {primaryVideo.width}×{primaryVideo.height}</div>
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                {primaryVideo.profile && <span>profile: {primaryVideo.profile} · </span>}
                {primaryVideo.frame_rate && <span>{primaryVideo.frame_rate} fps · </span>}
                {primaryVideo.is_hdr && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>HDR </span>}
                {primaryVideo.bit_rate && <span>{Math.round(parseInt(primaryVideo.bit_rate, 10) / 1000)} kbps</span>}
              </div>
            </div>
          ) : <div style={{ color: 'var(--muted)', fontSize: '.82rem' }}>No video metadata</div>}
          {streams?.video?.length > 1 && (
            <div style={{ color: 'var(--muted)', fontSize: '.75rem', marginTop: 4 }}>+ {streams.video.length - 1} additional video track(s)</div>
          )}
        </div>

        <div>
          <h4 style={{ fontSize: '.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 8 }}>Audio ({streams?.audio?.length || 0})</h4>
          <div>
            {(streams?.audio || []).map(a => (
              <StreamRow key={a.id}>
                <span style={{ color: 'var(--text)' }}>
                  {a.language.toUpperCase()} {a.is_default && <span style={{ color: 'var(--primary)' }}>*</span>}
                </span>
                <span style={{ color: 'var(--muted)' }}>
                  {a.codec} · {a.channels === 2 ? '2.0' : a.channels === 6 ? '5.1' : a.channels + 'ch'}
                  {a.title && <span> · {a.title}</span>}
                </span>
              </StreamRow>
            ))}
            {(!streams?.audio || streams.audio.length === 0) && <div style={{ color: 'var(--muted)', fontSize: '.82rem' }}>No audio tracks</div>}
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 8 }}>Subtitles ({streams?.subtitles?.length || 0})</h4>
          <div>
            {(streams?.subtitles || []).map(s => (
              <StreamRow key={s.id}>
                <span style={{ color: 'var(--text)' }}>
                  {s.language.toUpperCase()}
                  {s.is_forced && <span style={{ color: 'var(--accent)', fontSize: '.7rem', marginLeft: 4 }}>FORCED</span>}
                  {s.is_default && <span style={{ color: 'var(--primary)', fontSize: '.7rem', marginLeft: 4 }}>DEFAULT</span>}
                </span>
                <span style={{ color: 'var(--muted)', fontSize: '.78rem' }}>
                  {s.codec} {s.is_external ? '(ext)' : '(mux)'}
                </span>
              </StreamRow>
            ))}
            {(!streams?.subtitles || streams.subtitles.length === 0) && <div style={{ color: 'var(--muted)', fontSize: '.82rem' }}>No subtitles</div>}
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 8 }}>Optimization</h4>
          <div style={{ marginBottom: 10 }}>
            <StatusPill status={optim?.is_optimized ? 'completed' : (optim?.jobs?.some(j => j.status === 'in_progress') ? 'in_progress' : (optim?.jobs?.some(j => j.status === 'failed') ? 'failed' : 'pending'))} />
          </div>
          {optim?.jobs?.map(j => (
            <div key={j.rendition} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem' }}>
                <span style={{ color: 'var(--text)' }}>{j.rendition}</span>
                <span style={{ color: 'var(--muted)' }}>{j.status}{j.progress_percent > 0 && j.status === 'in_progress' ? ` · ${j.progress_percent}%` : ''}</span>
              </div>
              {j.status === 'in_progress' && (
                <div style={{ height: 3, background: 'var(--surface-container)', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
                  <div style={{ height: '100%', width: j.progress_percent + '%', background: 'var(--primary)', transition: 'width .3s' }} />
                </div>
              )}
              {j.status === 'failed' && j.error && <div style={{ color: '#e50914', fontSize: '.72rem', marginTop: 2 }}>{j.error}</div>}
            </div>
          ))}
          {optim?.total_size > 0 && <div style={{ color: 'var(--muted)', fontSize: '.75rem', marginTop: 6 }}>{(optim.total_size / 1024 / 1024).toFixed(1)} MB HLS output</div>}
          <button className="btn btn-sm btn-outline" onClick={triggerReencode} disabled={busy} style={{ marginTop: 8 }}>
            {busy ? 'Queuing...' : 'Re-encode'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MediaPage() {
  const [media, setMedia] = useState([])
  const [libraries, setLibraries] = useState([])
  const [tags, setTags] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ title: '', library_id: '', rating: '', tag_ids: [] })
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [filter, setFilter] = useState('all')

  const load = () => adminFetch('/media?limit=500').then(setMedia)
  useEffect(() => {
    load()
    adminFetch('/libraries').then(setLibraries)
    adminFetch('/tags').then(setTags)
  }, [])

  useEffect(() => {
    if (expanded !== null && media.some(m => m.optim_status === 'in_progress')) {
      const t = setInterval(load, 3000)
      return () => clearInterval(t)
    }
  }, [expanded, media])

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
    load()
  }

  const toggleTag = (tagId) => setForm(prev => ({
    ...prev,
    tag_ids: prev.tag_ids.includes(tagId)
      ? prev.tag_ids.filter(id => id !== tagId)
      : [...prev.tag_ids, tagId],
  }))

  const filtered = media.filter(m =>
    m.title?.toLowerCase().includes(search.toLowerCase()) &&
    (filter === 'all' || m.optim_status === filter)
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h1>Media</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container)', color: 'var(--text)', fontSize: '.85rem' }}>
            <option value="all">All ({media.length})</option>
            <option value="completed">Optimized ({media.filter(m => m.is_optimized).length})</option>
            <option value="pending">Not optimized</option>
            <option value="in_progress">Encoding…</option>
            <option value="failed">Failed</option>
          </select>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container)', color: 'var(--text)', fontSize: '.85rem' }}
          />
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <thead>
          <tr>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Title</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Type</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Video</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Subs</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Audio</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Optimization</th>
            <th style={{ padding: '12px 16px', textAlign: 'right', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 200).map(m => (
            <Fragment key={m.id}>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer' }} onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>
                  <span style={{ color: 'var(--muted)', marginRight: 6 }}>{expanded === m.id ? '▾' : '▸'}</span>
                  {m.title}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{m.media_type}</td>
                <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>
                  {m.height > 0 ? <span>{m.width}×{m.height} <span style={{ color: 'var(--muted)' }}>{m.video_codec}</span></span> : <span style={{ color: 'var(--muted)' }}>—</span>}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{m.subtitle_count || 0}</td>
                <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{m.audio_count || 0}</td>
                <td style={{ padding: '12px 16px' }}><StatusPill status={m.optim_status} /></td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <button className="btn btn-sm btn-outline" onClick={e => { e.stopPropagation(); openEdit(m) }}>Edit</button>
                </td>
              </tr>
              {expanded === m.id && (
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    <MediaDetail mediaId={m.id} />
                  </td>
                </tr>
              )}
            </Fragment>
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