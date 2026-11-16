import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

// Satu hook untuk semua komponen landing: menghormati prefers-reduced-motion
// sekaligus menjadi satu-satunya titik baca media query matchMedia.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = event => setReduced(event.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}
