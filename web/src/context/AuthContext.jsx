import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { getToken, setToken, clearToken, apiFetch } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)

  const checkAuth = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setLoading(false)
      return
    }
    try {
      const data = await apiFetch('/auth/me', { skipCache: true })
      if (data) {
        setRole(data.role)
        setUser({ token })
      }
    } catch {
      clearToken()
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const login = useCallback(async (username, password) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) throw new Error('Invalid credentials')
    const data = await res.json()
    setToken(data.token)
    setUser({ token: data.token })
    if (data.profiles?.length) {
      setProfiles(data.profiles)
    }
    setRole(data.role || null)
    return data
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setProfiles([])
    setRole(null)
  }, [])

  const isAuthenticated = !!user
  const isAdmin = role === 'admin'

  return (
    <AuthContext.Provider value={{ user, profiles, role, loading, isAuthenticated, isAdmin, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
