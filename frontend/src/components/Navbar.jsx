import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  BookMarked,
  ChevronDown,
  Compass,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Search,
  ShieldCheck,
  UserCircle2,
  X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

const navLinkClass = 'rounded-full px-3 py-1.5 text-sm font-medium text-ink/75 transition-colors hover:bg-cream hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay'
const iconButtonClass = 'inline-flex h-9 w-9 items-center justify-center rounded-full border border-sand bg-ivory text-charcoal transition-colors hover:border-clay hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay'

export default function Navbar() {
  const { user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const desktopSearchRef = useRef(null)
  const mobileSearchRef = useRef(null)
  const accountRef = useRef(null)

  useEffect(() => {
    const value = query.trim()
    if (!value) {
      setResults([])
      setSearching(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const json = await apiFetch(`/api/search?q=${encodeURIComponent(value)}`, {
          signal: controller.signal,
        })
        if (!cancelled) setResults(json.data || [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 500)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    if (!accountOpen) return
    const onPointerDown = event => {
      if (accountRef.current && !accountRef.current.contains(event.target)) setAccountOpen(false)
    }
    const onKey = event => {
      if (event.key === 'Escape') setAccountOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [accountOpen])

  function handleLogout() {
    logout()
    setAccountOpen(false)
    navigate('/library', { replace: true })
  }

  function openResult(id) {
    setQuery('')
    setResults([])
    setSearchOpen(false)
    navigate(`/read/${id}`)
  }

  function submitSearch(event) {
    event?.preventDefault()
    const value = query.trim()
    if (!value) return
    setQuery('')
    setResults([])
    setSearchOpen(false)
    navigate(`/search?q=${encodeURIComponent(value)}`)
  }

  function openSearch() {
    setSearchOpen(true)
    window.requestAnimationFrame(() => mobileSearchRef.current?.focus())
  }

  function searchField(inputRef) {
    return (
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') submitSearch(event)
            if (event.key === 'Escape' && searchOpen) setSearchOpen(false)
          }}
          type="search"
          aria-label="Cari buku atau penulis"
          placeholder="Cari buku atau penulis…"
          className="w-full rounded-full border border-sand bg-cream/70 py-2 pl-9 pr-8 text-sm text-charcoal placeholder:text-muted focus:border-clay focus:bg-white focus:outline-none focus:ring-2 focus:ring-clay/25"
        />
        {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-clay-deep" aria-hidden="true" />}
        {query.trim() && !searching && (
          <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-72 overflow-y-auto rounded-xl border border-sand bg-white p-1.5 shadow-xl">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted">Tidak ada hasil.</p>
            ) : results.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => openResult(item.id)}
                className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-clay"
              >
                <span className="block text-sm font-semibold text-charcoal">{item.title}</span>
                <span className="block text-xs text-muted">{item.author || 'Materi Edulib'} · Level {item.level || '-'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <header className="sticky top-0 z-50 border-b border-sand/80 bg-ivory/95 backdrop-blur-md">
      <nav className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2.5 sm:px-6 lg:px-8" aria-label="Navigasi aplikasi">
        <Link
          to="/library"
          className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-clay"
          aria-label="Edulib, perpustakaan"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-clay text-ivory shadow-sm">
            <BookMarked className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="font-serif text-xl tracking-tight text-charcoal">Edulib</span>
        </Link>

        <div className="ml-2 hidden items-center gap-1 md:flex">
          <Link to="/library" className={navLinkClass} aria-current={pathname === '/library' ? 'page' : undefined}>Perpustakaan</Link>
          <Link to="/karier" className={navLinkClass} aria-current={pathname === '/karier' || pathname.startsWith('/field/') ? 'page' : undefined}>Eksplorasi Karier</Link>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <Link to="/karier" className={`${iconButtonClass} md:hidden`} aria-label="Eksplorasi karier">
            <Compass className="h-4 w-4" aria-hidden="true" />
          </Link>

          <form role="search" onSubmit={submitSearch} className="relative hidden w-52 sm:block lg:w-72">
            {searchField(desktopSearchRef)}
          </form>

          <button type="button" className={`${iconButtonClass} sm:hidden`} onClick={openSearch} aria-label="Buka pencarian" aria-expanded={searchOpen}>
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>

          {user ? (
            <div ref={accountRef} className="relative">
              <button
                type="button"
                onClick={() => setAccountOpen(value => !value)}
                className="flex items-center gap-1.5 rounded-full border border-sand bg-ivory px-2 py-1.5 text-sm font-medium text-charcoal transition-colors hover:border-clay focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay sm:px-2.5"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                aria-label="Menu akun"
              >
                <UserCircle2 className="h-5 w-5 text-clay-deep" aria-hidden="true" />
                <span className="hidden max-w-[9rem] truncate lg:inline">{user.full_name ?? user.email ?? 'Pengguna'}</span>
                <ChevronDown className={`h-3.5 w-3.5 text-muted transition-transform ${accountOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>

              {accountOpen && (
                <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-sand bg-white p-1.5 shadow-xl">
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-semibold text-charcoal">{user.full_name ?? 'Pengguna'}</p>
                    {user.email && <p className="truncate text-xs text-muted">{user.email}</p>}
                  </div>
                  <Link role="menuitem" to="/dashboard" onClick={() => setAccountOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink transition-colors hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-clay">
                    <LayoutDashboard className="h-4 w-4 text-clay-deep" aria-hidden="true" /> Dashboard
                  </Link>
                  {isAdmin && (
                    <Link role="menuitem" to="/admin" onClick={() => setAccountOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink transition-colors hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-clay">
                      <ShieldCheck className="h-4 w-4 text-clay-deep" aria-hidden="true" /> Admin
                    </Link>
                  )}
                  <button role="menuitem" type="button" onClick={handleLogout} className="mt-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-clay">
                    <LogOut className="h-4 w-4 text-clay-deep" aria-hidden="true" /> Keluar
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 rounded-full bg-charcoal px-3 py-2 text-sm font-semibold text-ivory transition-colors hover:bg-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Masuk</span>
              <span className="sr-only sm:hidden">Masuk</span>
            </Link>
          )}
        </div>
      </nav>

      {searchOpen && (
        <div className="border-t border-sand/70 px-4 pb-3 pt-2 sm:hidden">
          <form role="search" onSubmit={submitSearch} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{searchField(mobileSearchRef)}</div>
            <button type="button" onClick={() => setSearchOpen(false)} className={iconButtonClass} aria-label="Tutup pencarian">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      )}
    </header>
  )
}
