import { useEffect, useState } from 'react'

// Matches the 180ms surface exit in desktop.css and dashboard.css.
export function useExitTransition<T>(value: T | null): T | null {
  const [retained, setRetained] = useState(value)
  // Keep the latest content without an extra stale frame on opening or switching.
  if (value !== null && value !== retained) setRetained(value)
  useEffect(() => {
    if (value !== null || retained === null) return
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
    const timer = window.setTimeout(() => setRetained(null), delay)
    return () => window.clearTimeout(timer)
  }, [value, retained])
  return value ?? retained
}
