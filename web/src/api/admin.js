const ADMIN_BASE = '/api/v1/admin'

async function adminFetch(path, opts = {}) {
  const token = localStorage.getItem('token')
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = 'Bearer ' + token

  const res = await fetch(ADMIN_BASE + path, { ...opts, headers })
  if (res.status === 401) {
    localStorage.removeItem('token')
    window.location.href = '/admin'
    return null
  }
  if (res.status === 204) return null
  return res.json()
}

export { adminFetch, ADMIN_BASE }
