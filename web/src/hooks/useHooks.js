import { useState, useEffect, useRef, useCallback } from 'react'

export function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export function useInterval(callback, delay) {
  const saved = useRef(callback)
  useEffect(() => { saved.current = callback }, [callback])
  useEffect(() => {
    if (delay === null) return
    const id = setInterval(() => saved.current(), delay)
    return () => clearInterval(id)
  }, [delay])
}

export function useDragScroll() {
  const ref = useRef(null)

  const onMouseDown = useCallback((e) => {
    const el = ref.current
    if (!el) return
    el.style.cursor = 'grabbing'
    el.style.userSelect = 'none'
    let startX = e.pageX - el.offsetLeft
    let scrollLeft = el.scrollLeft

    const onMove = (ev) => {
      const x = ev.pageX - el.offsetLeft
      el.scrollLeft = scrollLeft - (x - startX)
    }
    const onUp = () => {
      el.style.cursor = ''
      el.style.removeProperty('user-select')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return { ref, onMouseDown }
}

export function useScrollDirection(threshold = 10) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const handle = () => {
      setScrolled(window.scrollY > threshold)
    }
    window.addEventListener('scroll', handle, { passive: true })
    return () => window.removeEventListener('scroll', handle)
  }, [threshold])
  return scrolled
}
