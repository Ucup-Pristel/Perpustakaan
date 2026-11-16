import { useEffect, useState } from 'react'

// Breakpoint selaras dengan utilitas Tailwind `lg:` (1024px). Dipakai untuk
// mematikan parallax horizontal di layar kecil alih-alih mengandalkan CSS saja,
// karena transform tetap dihitung framer-motion walau elemennya tersembunyi.
const QUERY = '(min-width: 1024px)'

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = event => setIsDesktop(event.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isDesktop
}
