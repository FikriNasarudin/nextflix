import { createContext, useContext, useState, useCallback } from 'react'

const DetailModalContext = createContext(null)

export function DetailModalProvider({ children }) {
  const [item, setItem] = useState(null)

  const openDetail = useCallback((item) => setItem(item), [])
  const closeDetail = useCallback(() => setItem(null), [])

  return (
    <DetailModalContext.Provider value={{ item, openDetail, closeDetail }}>
      {children}
    </DetailModalContext.Provider>
  )
}

export function useDetailModal() {
  const ctx = useContext(DetailModalContext)
  if (!ctx) throw new Error('useDetailModal must be used within DetailModalProvider')
  return ctx
}
