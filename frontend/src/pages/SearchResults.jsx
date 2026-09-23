import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, Loader2, SearchX } from 'lucide-react'
import { apiFetch } from '../lib/api'

function BookCard({ item }) {
  return (
    <Link
      to={`/read/${item.id}`}
      className="group flex flex-col rounded-2xl border border-amber-100 bg-white shadow-sm hover:shadow-md hover:border-amber-300 overflow-hidden transition"
    >
      {/* Cover */}
      <div className="w-full aspect-[3/4] bg-amber-50 overflow-hidden">
        {item.cover_url
          ? <img src={item.cover_url} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
          : <div className="w-full h-full flex items-center justify-center"><BookOpen className="w-10 h-10 text-amber-200" /></div>
        }
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1 p-4 flex-1">
        <h2 className="text-sm font-bold text-amber-900 leading-snug line-clamp-2">{item.title}</h2>
        <p className="text-xs text-amber-700">{item.author || 'Materi ucup-edu-lib'}</p>
        {/* description intentionally hidden — still indexed by search */}
        <div className="flex flex-wrap gap-1 mt-auto pt-2">
          {item.sub_field_name && <span className="text-xs bg-amber-50 text-amber-800 px-2 py-0.5 rounded-full">{item.sub_field_name}</span>}
          {item.content_type  && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full uppercase">{item.content_type}</span>}
          {item.level != null && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Level {item.level}</span>}
        </div>
      </div>
    </Link>
  )
}

export default function SearchResults() {
  const [params] = useSearchParams()
  const q = params.get('q') || ''
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    apiFetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
      .then(json => { if (!cancelled) setResults(json.data || []) })
      .catch(err => { if (!cancelled && err.name !== 'AbortError') setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [q])

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl font-bold text-amber-900 mb-1">Hasil Pencarian</h1>
      <p className="text-sm text-amber-700 mb-8">
        {loading ? 'Mencari…' : `${results.length} hasil untuk `}
        {!loading && <span className="font-semibold">"{q}"</span>}
      </p>

      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {!loading && !error && results.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-amber-700">
          <SearchX className="w-12 h-12 opacity-40" />
          <p className="text-lg font-semibold">Tidak ada hasil ditemukan.</p>
          <p className="text-sm opacity-70">Coba kata kunci lain atau periksa ejaan.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {results.map(item => <BookCard key={item.id} item={item} />)}
        </div>
      )}
    </main>
  )
}
