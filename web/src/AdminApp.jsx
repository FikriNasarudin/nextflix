import { useAuth } from './context/AuthContext'
import AdminLayout from './components/admin/AdminLayout'
import DashboardPage from './pages/admin/DashboardPage'
import UsersPage from './pages/admin/UsersPage'
import LibrariesPage from './pages/admin/LibrariesPage'
import TagsPage from './pages/admin/TagsPage'
import MediaPage from './pages/admin/MediaPage'
import CollectionsAdminPage from './pages/admin/CollectionsAdminPage'
import SettingsPage from './pages/admin/SettingsPage'
import LoginOverlay from './components/auth/LoginOverlay'
import { useState, useEffect } from 'react'

const routes = {
  dashboard: DashboardPage,
  users: UsersPage,
  libraries: LibrariesPage,
  tags: TagsPage,
  media: MediaPage,
  collections: CollectionsAdminPage,
  settings: SettingsPage,
}

function getSection() {
  const path = window.location.pathname
  const parts = path.split('/').filter(Boolean)
  if (parts.length >= 2 && parts[0] === 'admin') {
    return parts[1] || 'dashboard'
  }
  return 'dashboard'
}

export default function AdminApp() {
  const { isAuthenticated, isAdmin, loading } = useAuth()
  const [section, setSection] = useState('dashboard')

  useEffect(() => {
    setSection(getSection())

    const handlePop = () => setSection(getSection())
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  const navigate = (sec) => {
    setSection(sec)
    window.history.pushState(null, '', '/admin/' + sec)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
        <div style={{ color: 'var(--muted)' }}>Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) return <LoginOverlay />
  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
        <div style={{ color: 'var(--muted)' }}>
          <h2>Access Denied</h2>
          <p>Admin privileges required.</p>
        </div>
      </div>
    )
  }

  const Page = routes[section] || DashboardPage

  return (
    <AdminLayout section={section} onNavigate={navigate}>
      <Page />
    </AdminLayout>
  )
}
