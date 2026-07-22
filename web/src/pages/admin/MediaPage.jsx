import { useState, useEffect, Fragment } from 'react'
import { adminFetch } from '../../api/admin'
import Modal from '../../components/admin/Modal'

function sizeFmt(bytes) {
  if (!bytes || bytes <= 0) return ''
  const mb = bytes / 1024 / 1024
  if (mb < 1024) return mb.toFixed(1) + ' MB'
  return (mb / 1024).toFixed(2) + ' GB'
}

const statusColor = {
  completed: 'var(--accent)',
  stale: '#ff9800',
  in_progress: 'var(--primary)',
  queued: 'var(--tertiary-container)',
  failed: '#e50914',
  pending: 'var(--muted)',
}

function StatusPill({ status }) {
  const labels = { in_progress: 'encoding', pending: 'not queued', stale: 'stale', completed: 'optimized', queued: 'queued' }
  const label = labels[status] || status
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
      color: status === 'completed' || status === 'failed' || status === 'stale' ? '#fff' : 'var(--bg)',
    }}>{label}</span>
  )
}

function EnrichIcon({ status, hasValue, enrichError }) {
  if (hasValue) {
    return <span style={{ color: 'var(--accent)', cursor: 'help' }} title="Done">&#10003;</span>
  }
  if (status === 'failed' || status === 'missing') {
    return <span style={{ color: '#e50914', cursor: 'help' }} title={enrichError || 'Missing/Failed'}>&#10007;</span>
  }
  return <span style={{ color: 'var(--muted)', cursor: 'help' }} title="Pending">&ndash;</span>
}

function StreamRow({ children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: '.82rem' }}>
      {children}
    </div>
  )
}

function MediaDetail({ mediaId }) {
  const [streams, setStreams] = useState(null)
  const [optim, setOptim] = useState(null)
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')

  const load = async () => {
    const [s, o, d] = await Promise.all([
      adminFetch('/media/' + mediaId + '/streams'),
      adminFetch('/media/' + mediaId + '/optimization'),
      adminFetch('/media/' + mediaId),
    ])
    setStreams(s)
    setOptim(o)
    setDetail(d)
  }

  useEffect(() => { load() }, [mediaId])

  const triggerReencode = async () => {
    setBusy(true)
    await adminFetch('/media/' + mediaId + '/re-encode', { method: 'POST' })
    setBusy(false)
    load()
  }

  const triggerCancelJob = async (rendition) => {
    await adminFetch('/encoder/cancel/' + mediaId + '/' + rendition, { method: 'POST' })
    load()
  }

  const triggerRefresh = async () => {
    setRefreshMsg('Refreshing...')
    try {
      const res = await adminFetch('/media/' + mediaId + '/refresh-metadata', { method: 'POST' })
      if (res?.status === 'ok') {
        setRefreshMsg('Done')
      } else {
        setRefreshMsg(res?.error || 'Failed')
      }
    } catch {
      setRefreshMsg('Failed')
    }
    load()
    setTimeout(() => setRefreshMsg(''), 5000)
  }

  const primaryVideo = streams?.video?.find(v => v.is_default) || streams?.video?.[0]
  const staleStatus = optim?.hls_stale ? 'stale' : optim?.is_optimized ? 'completed' : (optim?.jobs?.some(j => j.status === 'in_progress') ? 'in_progress' : (optim?.jobs?.some(j => j.status === 'failed') ? 'failed' : 'pending'))

  return (
    <div style={{ padding: '12px 24px 20px', background: 'var(--surface-container-low)', borderTop: '1px dashed rgba(255,255,255,.06)' }}>
      {optim?.hls_stale && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', marginBottom: 12, borderRadius: 'var(--radius)', background: 'rgba(255,152,0,.12)', border: '1px solid rgba(255,152,0,.3)' }}>
          <span style={{ fontSize: '1.2rem' }}>&#9888;</span>
          <span style={{ flex: 1, fontSize: '.85rem', color: '#ff9800' }}>
            Source file updated since last encode - HLS is stale. Re-encode to match the current source.
          </span>
        </div>
      )}
      {detail && (
        <div style={{ marginBottom: 16, background: 'rgba(255,255,255,.03)', borderRadius: 'var(--radius)', padding: 14, border: '1px solid rgba(255,255,255,.06)' }}>
          <h4 style={{ fontSize: '.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 10 }}>Metadata</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '.82rem', marginBottom: 10 }}>
            <div><span style={{ color: 'var(--muted)' }}>TMDB ID:</span> {detail.tmdb_id || <span style={{ color: '#e50914' }}>Not set</span>}</div>
            <div><span style={{ color: 'var(--muted)' }}>Year:</span> {detail.year || '—'}</div>
            {detail.overview && <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--muted)' }}>Overview:</span> {detail.overview}</div>}
            <div><span style={{ color: 'var(--muted)' }}>Status:</span> <EnrichIcon status={detail.enrich_status} hasValue={detail.tmdb_id && detail.overview} enrichError={detail.enrich_error} /> {detail.enrich_status}{detail.last_enriched_at ? ' · ' + detail.last_enriched_at : ''}</div>
            {detail.enrich_error && <div style={{ gridColumn: '1 / -1', color: '#e50914' }}>Error: {detail.enrich_error}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-sm btn-primary" onClick={triggerRefresh} disabled={refreshMsg === 'Refreshing...'} style={{ background: 'var(--accent)' }}>
              {refreshMsg === 'Refreshing...' ? 'Refreshing...' : 'Refresh Metadata'}
            </button>
            {refreshMsg && refreshMsg !== 'Refreshing...' && (
              <span style={{ fontSize: '.78rem', color: refreshMsg === 'Done' ? 'var(--accent)' : '#e50914' }}>{refreshMsg}</span>
            )}
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 10 }}>
        <div>
          <h4 style={{ fontSize: '.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)', marginBottom: 8 }}>Video</h4>
          {primaryVideo ? (
            <div style={{ fontSize: '.82rem', color: 'var(--text)' }}>
              <div><strong>{primaryVideo.codec.toUpperCase()}</strong> &middot; {primaryVideo.width}&times;{primaryVideo.height}</div>
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                {primaryVideo.profile && <span>profile: {primaryVideo.profile} &middot; </span>}
                {primaryVideo.frame_rate && <span>{primaryVideo.frame_rate} fps &middot; </span>}
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
                  {a.codec} &middot; {a.channels === 2 ? '2.0' : a.channels === 6 ? '5.1' : a.channels + 'ch'}
                  {a.title && <span> &middot; {a.title}</span>}
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
            <StatusPill status={staleStatus} />
          </div>
          {optim?.jobs?.map(j => (
            <div key={j.rendition} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.78rem' }}>
                <span style={{ color: 'var(--text)' }}>{j.rendition}</span>
                <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {j.status}{j.progress_percent > 0 && j.status === 'in_progress' ? ' &middot; ' + j.progress_percent + '%' : ''}
                  {j.status === 'completed' && j.output_size > 0 ? ' &middot; ' + sizeFmt(j.output_size) : ''}
                  {j.status === 'in_progress' && (
                    <button className="btn btn-sm" onClick={() => triggerCancelJob(j.rendition)} style={{ fontSize: '.7rem', padding: '1px 6px', background: 'transparent', color: '#e50914', border: '1px solid rgba(229,9,20,.4)', cursor: 'pointer' }} title="Cancel">
                      &#10005;
                    </button>
                  )}
                </span>
              </div>
              {j.status === 'in_progress' && (
                <div style={{ height: 3, background: 'var(--surface-container)', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
                  <div style={{ height: '100%', width: j.progress_percent + '%', background: 'var(--primary)', transition: 'width .3s' }} />
                </div>
              )}
              {j.status === 'failed' && j.error && <div style={{ color: '#e50914', fontSize: '.72rem', marginTop: 2 }}>{j.error}</div>}
            </div>
          ))}
          <button className={optim?.hls_stale ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline'} onClick={triggerReencode} disabled={busy} style={{ marginTop: 8 }}>
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
  const [form, setForm] = useState({ title: '', library_id: '', rating: '', tag_ids: [], overview: '', year: '', tmdb_id: '', poster_path: '', backdrop_path: '', show_name: '', season_number: '', episode_number: '', episode_title: '' })
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [filter, setFilter] = useState('all')
  const [enrichFilter, setEnrichFilter] = useState('')
  const [error, setError] = useState(null)

  const load = () => adminFetch('/media?limit=500')
    .then(data => { setMedia(data); setError(null) })
    .catch(e => setError(e.message))
  useEffect(() => {
    load()
    adminFetch('/libraries').then(setLibraries).catch(() => {})
    adminFetch('/tags').then(setTags).catch(() => {})
  }, [])

  useEffect(() => {
    if (expanded !== null && media.some(m => m.optim_status === 'in_progress' || m.optim_status === 'stale' || m.enrich_status === 'pending')) {
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
      overview: item.overview || '',
      year: item.year || '',
      tmdb_id: item.tmdb_id ? String(item.tmdb_id) : '',
      poster_path: item.poster_path || '',
      backdrop_path: item.backdrop_path || '',
      show_name: item.show_name || '',
      season_number: item.season_number ? String(item.season_number) : '',
      episode_number: item.episode_number ? String(item.episode_number) : '',
      episode_title: item.episode_title || '',
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    await adminFetch('/media/' + editing.id, { method: 'PUT', body: JSON.stringify({
      title: form.title,
      library_id: form.library_id ? parseInt(form.library_id, 10) : null,
      rating: form.rating,
      overview: form.overview,
      year: form.year,
      tmdb_id: form.tmdb_id ? parseInt(form.tmdb_id, 10) : null,
      poster_path: form.poster_path,
      backdrop_path: form.backdrop_path,
      show_name: form.show_name,
      season_number: form.season_number ? parseInt(form.season_number, 10) : null,
      episode_number: form.episode_number ? parseInt(form.episode_number, 10) : null,
      episode_title: form.episode_title,
    }) })
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

  const staleCount = media.filter(m => m.hls_stale).length
  const filtered = media.filter(m =>
    m.title?.toLowerCase().includes(search.toLowerCase()) &&
    (filter === 'all' ? true : filter === 'stale' ? !!m.hls_stale : m.optim_status === filter) &&
    (enrichFilter === '' ||
      (enrichFilter === 'missing_tmdb' ? (!m.tmdb_id) :
       enrichFilter === 'missing_overview' ? (!m.overview) :
       enrichFilter === 'missing_poster' ? (!m.poster_path) :
       enrichFilter === 'failed' ? m.enrich_status === 'failed' :
       true))
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h1>Media</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={enrichFilter} onChange={e => setEnrichFilter(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container)', color: 'var(--text)', fontSize: '.85rem' }}>
            <option value="">All</option>
            <option value="missing_tmdb">Missing TMDB</option>
            <option value="missing_overview">Missing Overview</option>
            <option value="missing_poster">Missing Poster</option>
            <option value="failed">Failed</option>
          </select>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container)', color: 'var(--text)', fontSize: '.85rem' }}>
            <option value="all">All ({media.length})</option>
            <option value="completed">Optimized ({media.filter(m => m.is_optimized && !m.hls_stale).length})</option>
            <option value="stale">&#9888; Stale ({staleCount})</option>
            <option value="pending">Not optimized</option>
            <option value="in_progress">Encoding..</option>
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

      {error && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 'var(--radius)', background: 'rgba(229,9,20,.12)', border: '1px solid rgba(229,9,20,.3)', fontSize: '.85rem', color: '#e50914' }}>
          Failed to load media: {error}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <thead>
          <tr>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Title</th>
            <th style={{ padding: '12px 16px', textAlign: 'left', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.75rem' }}>Type</th>
            <th style={{ padding: '12px 8px', textAlign: 'center', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.7rem' }} title="TMDB ID">TMDB</th>
            <th style={{ padding: '12px 8px', textAlign: 'center', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.7rem' }} title="Poster">Post</th>
            <th style={{ padding: '12px 8px', textAlign: 'center', background: 'var(--surface-container-high)', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: '.7rem' }} title="Overview">Ovw</th>
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
                  <span style={{ color: 'var(--muted)', marginRight: 6 }}>{expanded === m.id ? '&#9662;' : '&#9656;'}</span>
                  {m.title}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{m.media_type}</td>
                <td style={{ padding: '12px 8px', textAlign: 'center', fontSize: '.85rem' }}>
                  <EnrichIcon status={m.enrich_status} hasValue={m.tmdb_id} enrichError={m.enrich_error} />
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center', fontSize: '.85rem' }}>
                  <EnrichIcon status={m.enrich_status} hasValue={m.poster_path} enrichError={m.enrich_error} />
                </td>
                <td style={{ padding: '12px 8px', textAlign: 'center', fontSize: '.85rem' }}>
                  <EnrichIcon status={m.enrich_status} hasValue={m.overview} enrichError={m.enrich_error} />
                </td>
                <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>
                  {m.height > 0 ? <span>{m.width}&times;{m.height} <span style={{ color: 'var(--muted)' }}>{m.video_codec}</span></span> : <span style={{ color: 'var(--muted)' }}>&mdash;</span>}
                </td>
                <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{m.subtitle_count || 0}</td>
                <td style={{ padding: '12px 16px', fontSize: '.85rem' }}>{m.audio_count || 0}</td>
                <td style={{ padding: '12px 16px', display: 'flex', gap: 4, alignItems: 'center' }}>
                  <StatusPill status={m.optim_status} />
                  {m.hls_stale && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ff9800' }} />}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <button className="btn btn-sm btn-outline" onClick={e => { e.stopPropagation(); openEdit(m) }}>Edit</button>
                </td>
              </tr>
              {expanded === m.id && (
                <tr>
                  <td colSpan={10} style={{ padding: 0 }}>
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
              TMDB ID
              <input type="number" value={form.tmdb_id} onChange={e => setForm({ ...form, tmdb_id: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Year
              <input type="text" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Overview
              <textarea value={form.overview} onChange={e => setForm({ ...form, overview: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4, minHeight: 60, resize: 'vertical' }} />
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Poster Path
              <input type="text" value={form.poster_path} onChange={e => setForm({ ...form, poster_path: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Backdrop Path
              <input type="text" value={form.backdrop_path} onChange={e => setForm({ ...form, backdrop_path: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
              Rating
              <input type="text" value={form.rating} onChange={e => setForm({ ...form, rating: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
            </label>
            {editing?.media_type !== 'movie' && (
              <>
                <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
                  Show Name
                  <input type="text" value={form.show_name} onChange={e => setForm({ ...form, show_name: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
                </label>
                <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
                  Season Number
                  <input type="number" value={form.season_number} onChange={e => setForm({ ...form, season_number: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
                </label>
                <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
                  Episode Number
                  <input type="number" value={form.episode_number} onChange={e => setForm({ ...form, episode_number: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
                </label>
                <label style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
                  Episode Title
                  <input type="text" value={form.episode_title} onChange={e => setForm({ ...form, episode_title: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius)', background: 'var(--surface-container-low)', color: 'var(--text)', fontSize: '.9rem', marginTop: 4 }} />
                </label>
              </>
            )}
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