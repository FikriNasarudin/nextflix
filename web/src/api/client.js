const API_BASE = '/api/v1'

function getToken() {
  return localStorage.getItem('token')
}

function setToken(t) {
  localStorage.setItem('token', t)
}

function clearToken() {
  localStorage.removeItem('token')
}

let toastTimer = null

export function showToast(msg, type) {
  let t = document.getElementById('toast')
  if (!t) {
    t = document.createElement('div')
    t.id = 'toast'
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 20px;border-radius:6px;font-size:.85rem;transition:opacity .3s;max-width:90vw;text-align:center'
    document.body.appendChild(t)
  }
  t.textContent = msg
  t.style.background = type === 'error' ? '#e74c3c' : '#2ecc71'
  t.style.color = '#fff'
  t.style.opacity = '1'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.style.opacity = '0' }, 4000)
}

export function isSlowConnection() {
  const conn = navigator.connection
  return conn && (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g')
}

export function canPlayDirect(item) {
  const { video_codec: codec, container, is_hdr } = item
  if (!container) return false

  const mime = 'video/' + container
  const el = document.createElement('video')
  const supported = el.canPlayType(mime)

  if (supported === 'probably') return true
  if (supported === '') return false

  if (container === 'webm') return true

  if (container === 'mp4' || container === 'm4v' || container === 'mov') {
    if (is_hdr) return false
    if (codec === 'hevc' || codec === 'h265') {
      const hevcSupported = el.canPlayType('video/mp4; codecs="hev1"')
      return hevcSupported === 'probably'
    }
    if (codec === 'h264' || !codec) return true
    return false
  }

  return false
}

function tokenParam() {
  const t = getToken()
  return t ? '?token=' + encodeURIComponent(t) : ''
}

export function imageUrl(path, id, type, size) {
  type = type || 'poster'
  size = size || 'w342'
  if (!path) {
    if (id) return API_BASE + '/image/local/' + type + '/' + id + tokenParam()
    return ''
  }
  if (path.startsWith('/')) return API_BASE + '/image/tmdb/' + size + path + tokenParam()
  return path
}

export function backdropUrl(backdrop, poster, id) {
  if (backdrop) return backdrop.startsWith('/') ? API_BASE + '/image/tmdb/original' + backdrop + tokenParam() : backdrop
  if (poster) return poster.startsWith('/') ? API_BASE + '/image/tmdb/w1280' + poster + tokenParam() : poster
  if (id) return API_BASE + '/image/local/backdrop/' + id + tokenParam()
  return ''
}

const _cache = new Map()
const _inflight = new Map()

export async function apiFetch(path, opts = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = 'Bearer ' + token

  const isGet = !opts.method || opts.method === 'GET'
  const cacheKey = (opts.method || 'GET') + ' ' + path
  const skipCache = opts.skipCache === true

  if (isGet && !skipCache) {
    if (_cache.has(cacheKey)) {
      const cached = _cache.get(cacheKey)
      if (cached.expires > Date.now()) return cached.data
    }
    if (_inflight.has(cacheKey)) return _inflight.get(cacheKey)
  }

  const promise = (async () => {
    try {
      const res = await fetch(API_BASE + path, { ...opts, headers })
      if (res.status === 401) {
        clearToken()
        window.location.href = '/'
        return null
      }
      if (res.status === 204) return null
      const data = await res.json()

      if (isGet && !skipCache) {
        _cache.set(cacheKey, { data, expires: Date.now() + 60000 })
      }
      return data
    } catch (err) {
      showToast('Network error', 'error')
      throw err
    } finally {
      if (isGet && !skipCache) _inflight.delete(cacheKey)
    }
  })()

  if (isGet && !skipCache) _inflight.set(cacheKey, promise)
  return promise
}

export function invalidateCache(prefix) {
  if (!prefix) { _cache.clear(); return }
  for (const key of _cache.keys()) {
    if (key.indexOf(prefix) !== -1) _cache.delete(key)
  }
}

export function clearCache() {
  _cache.clear()
}

export { getToken, setToken, clearToken, API_BASE, tokenParam }
