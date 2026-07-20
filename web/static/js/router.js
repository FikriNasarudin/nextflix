window.NextflixRouter = (function() {
  var _routes = []
  var _currentPath = null
  var _beforeNavigate = null

  function resolve(path) {
    for (var i = 0; i < _routes.length; i++) {
      var route = _routes[i]
      var match = path.match(route.regex)
      if (match) {
        var params = {}
        for (var j = 0; j < route.paramNames.length; j++) {
          params[route.paramNames[j]] = match[j + 1]
        }
        return { handler: route.handler, params: params }
      }
    }
    return null
  }

  return {
    addRoute: function(pattern, handler) {
      var paramNames = []
      var regexStr = pattern.replace(/:(\w+)/g, function(_, name) {
        paramNames.push(name)
        return '([^/]+)'
      })
      _routes.push({
        regex: new RegExp('^' + regexStr + '$'),
        paramNames: paramNames,
        handler: handler
      })
    },

    onBeforeNavigate: function(fn) {
      _beforeNavigate = fn
    },

    navigate: function(path) {
      if (_beforeNavigate) _beforeNavigate(path)
      history.pushState(null, '', path)
      _currentPath = path
      this.handlePath(path)
    },

    replace: function(path) {
      history.replaceState(null, '', path)
      _currentPath = path
      this.handlePath(path)
    },

    handlePath: function(path) {
      var resolved = resolve(path)
      if (resolved) {
        _currentPath = path
        resolved.handler(resolved.params)
      }
    },

    getCurrentPath: function() {
      return _currentPath || window.location.pathname
    },

    init: function() {
      window.addEventListener('popstate', function() {
        this.handlePath(window.location.pathname)
      }.bind(this))

      document.addEventListener('click', function(e) {
        var link = e.target.closest('[data-nav]')
        if (link) {
          e.preventDefault()
          this.navigate(link.getAttribute('href') || link.dataset.nav)
        }
      }.bind(this))
    }
  }
})()
