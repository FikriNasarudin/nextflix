import { createContext, useContext, useState, useCallback, useRef } from 'react'

const DetailModalContext = createContext(null)

export function DetailModalProvider({ children }) {
  const [item, setItem] = useState(null)
  const [history, setHistory] = useState([])
  const itemRef = useRef(null)
  itemRef.current = item

  const openDetail = useCallback((nextItem) => {
    setItem(nextItem)
    setHistory([])
  }, [])

  const pushDetail = useCallback((nextItem) => {
    setHistory(prev => [...prev, itemRef.current])
    setItem(nextItem)
  }, [])

  const goBack = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev
      const newHistory = [...prev]
      const prevItem = newHistory.pop()
      setItem(prevItem)
      return newHistory
    })
  }, [])

  const closeDetail = useCallback(() => {
    setItem(null)
    setHistory([])
  }, [])

  return (
    <DetailModalContext.Provider value={{ item, openDetail, pushDetail, goBack, closeDetail, hasHistory: history.length > 0 }}>
      {children}
    </DetailModalContext.Provider>
  )
}

export function useDetailModal() {
  const ctx = useContext(DetailModalContext)
  if (!ctx) throw new Error('useDetailModal must be used within DetailModalProvider')
  return ctx
}
