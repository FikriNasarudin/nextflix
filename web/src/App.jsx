import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/layout/Layout'
import LoginOverlay from './components/auth/LoginOverlay'
import HomePage from './pages/HomePage'
import DetailPage from './pages/DetailPage'
import BrowsePage from './pages/BrowsePage'
import AllMoviesPage from './pages/AllMoviesPage'
import AllTVPage from './pages/AllTVPage'
import CollectionsPage from './pages/CollectionsPage'
import PlayerPage from './pages/PlayerPage'

export default function App() {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
        <div style={{ color: 'var(--muted)', fontSize: '1.2rem' }}>Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginOverlay />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/detail/:id" element={<DetailPage />} />
        <Route path="/browse/movies" element={<AllMoviesPage />} />
        <Route path="/browse/tv" element={<AllTVPage />} />
        <Route path="/browse/:section" element={<BrowsePage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/watch/:id" element={<PlayerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
