window.NextflixAPI = (function() {
  var API = '/api/v1'
  var _cache = new Map()
  var _inflight = new Map()

  function getToken() { return localStorage.getItem('token') }
  function setToken(t) { localStorage.setItem('token', t) }
  function clearToken() { localStorage.removeItem('token') }
  function tokenParam() { var t = getToken(); return t ? '?token=' + encodeURIComponent(t) : '' }

  function showToast(msg, type) {
    var t = document.getElementById('toast')
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
    clearTimeout(t._hide)
    t._hide = setTimeout(function(){ t.style.opacity = '0' }, 4000)
  }

  function isSlowConnection() {
    var conn = navigator.connection
    return conn && (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g')
  }

    return {
    API: API,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    showToast: showToast,
    isSlowConnection: isSlowConnection,

    imageUrl: function(path, id, type, size) {
      type = type || 'poster';
      size = size || 'w342';
      if (!path) {
        if (id) return API + '/image/local/' + type + '/' + id + tokenParam();
        return '';
      }
      if (path.startsWith('/')) return API + '/image/tmdb/' + size + path + tokenParam();
      return path;
    },

    backdropUrl: function(backdrop, poster, id) {
      if (backdrop) return backdrop.startsWith('/') ? API + '/image/tmdb/original' + backdrop + tokenParam() : backdrop;
      if (poster) return poster.startsWith('/') ? API + '/image/tmdb/w1280' + poster + tokenParam() : poster;
      if (id) return API + '/image/local/backdrop/' + id + tokenParam();
      return '';
    },

    fetch: async function(path, opts) {
      opts = opts || {}
      var token = getToken()
      var headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = 'Bearer ' + token

      var isGet = !opts.method || opts.method === 'GET'
      var cacheKey = (opts.method || 'GET') + ' ' + path

      var skipCache = opts.skipCache === true

      if (isGet && !skipCache) {
        if (_cache.has(cacheKey)) {
          var cached = _cache.get(cacheKey)
          if (cached.expires > Date.now()) return cached.data
        }
        if (_inflight.has(cacheKey)) return _inflight.get(cacheKey)
      }

      var promise = (async function() {
        try {
          var res = await fetch(API + path, Object.assign({}, opts, { headers: headers }))
          if (res.status === 401) {
            clearToken()
            window.location.href = '/'
            return null
          }
          if (res.status === 204) return null
          var data = await res.json()

          if (isGet && !skipCache) {
            _cache.set(cacheKey, { data: data, expires: Date.now() + 60000 })
          }

          return data
        } catch (err) {
          showToast('Network error', 'error')
          return null
        } finally {
          if (isGet && !skipCache) _inflight.delete(cacheKey)
        }
      })()
      if (isGet && !skipCache) _inflight.set(cacheKey, promise)
      return promise
    },

    invalidate: function(prefix) {
      if (!prefix) { _cache.clear(); return }
      var keys = Array.from(_cache.keys())
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(prefix) !== -1) _cache.delete(keys[i])
      }
    },

    clearCache: function() { _cache.clear() }
  }
})()
