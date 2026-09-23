import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, Compass, Loader2, LogIn, LogOut, Search, UserCircle2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)

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

  function handleLogout() {
    logout()
    navigate('/', { replace: true })
  }

  function openResult(id) {
    setQuery('')
    setResults([])
    navigate(`/read/${id}`)
  }

  function handleKeyDown(event) {
    if (event.key !== 'Enter') return
    const value = query.trim()
    if (!value) return
    setQuery('')
    setResults([])
    navigate(`/search?q=${encodeURIComponent(value)}`)
  }

  return (
    <nav className="sticky top-0 z-50 bg-amber-800 shadow-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
        <Link to="/" className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-amber-100 shrink-0"><BookOpen className="w-5 h-5 text-amber-800" /></div>
          <div className="min-w-0"><span className="text-white font-bold text-lg leading-tight block truncate">Kompas Karier &amp; Minat</span><span className="text-amber-200 text-xs flex items-center gap-1"><Compass className="w-3 h-3" /> Perpustakaan Digital</span></div>
        </Link>

        <div className="relative order-3 w-full sm:order-none sm:w-72">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-amber-700" />
          <input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={handleKeyDown} placeholder="Cari buku atau penulis..." className="w-full rounded-lg bg-amber-50 py-2 pl-9 pr-8 text-sm text-amber-900 placeholder-amber-500 outline-none ring-0 focus:ring-2 focus:ring-amber-300" />
          {searching && <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-amber-700" />}
          {query.trim() && !searching && (
            <div className="absolute left-0 right-0 top-full mt-2 max-h-72 overflow-y-auto rounded-xl border border-amber-100 bg-white p-2 shadow-xl">
              {results.length === 0 ? <p className="px-3 py-2 text-sm text-gray-500">Tidak ada hasil.</p> : results.map(item => <button key={item.id} onClick={() => openResult(item.id)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-amber-50"><span className="block text-sm font-semibold text-amber-900">{item.title}</span><span className="block text-xs text-amber-700">{item.author || 'Materi ucup-edu-lib'} · Level {item.level || '-'}</span></button>)}
            </div>
          )}
        </div>

        {user ? (
          <div className="flex items-center gap-2 shrink-0"><div className="hidden lg:flex items-center gap-1.5 text-amber-100 text-sm"><UserCircle2 className="w-4 h-4" /><span className="truncate max-w-[120px]">{user.full_name ?? user.email ?? 'Pengguna'}</span></div><button onClick={handleLogout} className="flex items-center gap-1.5 bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"><LogOut className="w-3.5 h-3.5" /> Keluar</button></div>
        ) : (
          <Link to="/login" className="shrink-0 flex items-center gap-1.5 bg-amber-100 hover:bg-white text-amber-800 text-xs font-semibold px-3 py-1.5 rounded-lg transition"><LogIn className="w-3.5 h-3.5" /> Masuk</Link>
        )}
      </div>
    </nav>
  )
}
