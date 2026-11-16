import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookMarked, Compass, Menu, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const SECTION_LINKS = [
  { label: 'Tentang', hash: 'tentang' },
  { label: 'Fitur', hash: 'fitur' },
  { label: 'Koleksi', hash: 'koleksi' },
  { label: 'Karier', hash: 'karier' },
  { label: 'Misi', hash: 'misi' },
]

/**
 * Navigasi landing. Terpisah dari Navbar perpustakaan supaya landing bisa
 * memakai latar terang yang berubah saat digulir, sementara halaman aplikasi
 * tetap memakai navbar amber yang sudah ada.
 *
 * `active` dipakai untuk memudarkan background saat di atas hero.
 */
export default function LandingNavbar({ active = true }) {
  const { isAuthenticated } = useAuth()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const panelRef = useRef(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = event => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        active && !scrolled
          ? 'bg-transparent'
          : 'border-b border-sand/80 bg-ivory/90 backdrop-blur-md'
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2.5" aria-label="Edulib, beranda">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-clay text-ivory shadow-sm">
            <BookMarked className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="font-serif text-xl tracking-tight text-charcoal">Edulib</span>
        </Link>

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Navigasi utama">
          {SECTION_LINKS.map(({ label, hash }) => (
            <a
              key={hash}
              href={`#${hash}`}
              className="text-sm text-ink/70 transition hover:text-clay-deep"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            to="/library"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-ink/80 transition hover:text-clay-deep"
          >
            <Compass className="h-4 w-4" aria-hidden="true" /> Perpustakaan
          </Link>
          {isAuthenticated ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-full bg-charcoal px-4 py-2 text-sm font-semibold text-ivory transition hover:bg-clay-deep"
            >
              Dashboard <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 rounded-full bg-charcoal px-4 py-2 text-sm font-semibold text-ivory transition hover:bg-clay-deep"
            >
              Masuk <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          className="inline-flex items-center justify-center rounded-full border border-sand bg-ivory p-2 text-charcoal lg:hidden"
          aria-expanded={open}
          aria-controls="landing-mobile-menu"
          aria-label={open ? 'Tutup menu' : 'Buka menu'}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div
          ref={panelRef}
          id="landing-mobile-menu"
          className="border-t border-sand bg-ivory px-4 pb-5 pt-3 lg:hidden"
        >
          <nav className="flex flex-col" aria-label="Navigasi mobile">
            {SECTION_LINKS.map(({ label, hash }) => (
              <a
                key={hash}
                href={`#${hash}`}
                onClick={() => setOpen(false)}
                className="border-b border-sand/60 py-3 text-sm text-ink/80"
              >
                {label}
              </a>
            ))}
            <Link to="/library" onClick={() => setOpen(false)} className="border-b border-sand/60 py-3 text-sm text-ink/80">
              Perpustakaan
            </Link>
            <Link
              to={isAuthenticated ? '/dashboard' : '/login'}
              onClick={() => setOpen(false)}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-charcoal px-4 py-2.5 text-sm font-semibold text-ivory"
            >
              {isAuthenticated ? 'Dashboard' : 'Masuk'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}
