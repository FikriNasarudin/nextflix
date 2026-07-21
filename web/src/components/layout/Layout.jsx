import { Outlet } from 'react-router-dom'
import TopNav from './TopNav'
import BottomNav from './BottomNav'

export default function Layout({ children }) {
  return (
    <>
      <TopNav />
      <BottomNav />
      <main style={{ paddingTop: 64 }}>
        {children || <Outlet />}
      </main>
    </>
  )
}
