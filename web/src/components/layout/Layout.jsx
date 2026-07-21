import { Outlet } from 'react-router-dom'
import TopNav from './TopNav'
import BottomNav from './BottomNav'
import DetailModal from '../detail/DetailModal'
import { useDetailModal } from '../../context/DetailModalContext'

export default function Layout({ children }) {
  const { item } = useDetailModal()

  return (
    <>
      <TopNav />
      <BottomNav />
      <main style={{ paddingTop: 64 }}>
        {children || <Outlet />}
      </main>
      {item && <DetailModal />}
    </>
  )
}
