import { useEffect, useState } from 'react'
import { ChevronRight, Layers, BookMarked, AlertTriangle } from 'lucide-react'

// --- Skeleton ---
function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-orange-100 p-4 animate-pulse">
      <div className="flex gap-2 mb-3">
        <div className="w-4 h-4 bg-gray-200 rounded shrink-0 mt-0.5" />
        <div className="h-4 bg-gray-200 rounded w-3/4" />
      </div>
      <div className="h-3 bg-gray-100 rounded w-full mb-1.5" />
      <div className="h-3 bg-gray-100 rounded w-2/3 mb-3" />
      <div className="flex gap-1.5">
        <div className="h-5 bg-amber-100 rounded-full w-20" />
        <div className="h-5 bg-amber-100 rounded-full w-16" />
      </div>
    </div>
  )
}

function SkeletonSection() {
  return (
    <section className="mb-10 animate-pulse">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 bg-gray-200 rounded-full shrink-0" />
        <div>
          <div className="h-5 bg-gray-300 rounded w-40 mb-1.5" />
          <div className="h-3 bg-gray-200 rounded w-56" />
        </div>
      </div>
      <div className="pl-4 border-l-2 border-amber-200 ml-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
      </div>
    </section>
  )
}

// --- Error banner ---
function ErrorBanner({ message }) {
  return (
    <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 my-6">
      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-sm">Gagal memuat data</p>
        <p className="text-xs mt-0.5 text-red-600">{message}</p>
      </div>
    </div>
  )
}

// --- Field card ---
function FieldCard({ field }) {
  const color = field.color ?? '#92400e'
  return (
    <div className="bg-white rounded-xl border border-orange-100 shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <Layers className="w-4 h-4 mt-0.5 shrink-0" style={{ color }} />
        <h4 className="font-semibold text-gray-800 text-sm leading-snug flex items-center gap-1.5 flex-wrap">
          {field.icon && <span>{field.icon}</span>}
          {field.name}
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        </h4>
      </div>
      {field.description && (
        <p className="text-gray-500 text-xs leading-relaxed">{field.description}</p>
      )}
      <div className="flex flex-wrap gap-1.5 mt-1">
        <span className="inline-flex items-center gap-1 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-full px-2.5 py-0.5">
          <BookMarked className="w-3 h-3 shrink-0" />
          {field.slug}
        </span>
        <span className={`text-xs rounded-full px-2.5 py-0.5 font-medium border ${
          field.is_active
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-gray-100 text-gray-400 border-gray-200'
        }`}>
          {field.is_active ? 'Aktif' : 'Nonaktif'}
        </span>
      </div>
    </div>
  )
}

// --- Main ---
export default function Home() {
  const [fields, setFields]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    fetch('/api/fields')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`)
        return r.json()
      })
      .then(json => setFields(json.data ?? []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="min-h-screen bg-orange-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-amber-800 to-orange-700 text-white px-4 sm:px-6 py-12 text-center">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
          Pohon Minat &amp; Karier
        </h1>
        <p className="text-amber-100 max-w-xl mx-auto text-sm sm:text-base">
          Temukan bidang yang sesuai dengan minatmu. Jelajahi sub-bidang dan konten
          pembelajaran yang tersedia untuk memandu kariermu.
        </p>
        <div className="flex items-center justify-center gap-1.5 mt-4 text-amber-200 text-xs">
          <ChevronRight className="w-4 h-4" />
          <span>Gulir ke bawah untuk melihat peta bidang</span>
        </div>
      </div>

      {/* Tree content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex items-center gap-2 mb-6">
          <span className="h-px flex-1 bg-amber-200" />
          <span className="text-amber-700 font-semibold text-sm uppercase tracking-widest">
            Bidang Utama
          </span>
          <span className="h-px flex-1 bg-amber-200" />
        </div>

        {loading && <SkeletonSection />}
        {error   && <ErrorBanner message={error} />}

        {!loading && !error && fields.length === 0 && (
          <p className="text-center text-gray-400 py-12">Tidak ada data bidang.</p>
        )}

        {!loading && !error && fields.length > 0 && (
          <section className="mb-10">
            <div className="flex items-center gap-3 mb-5">
              <span className="text-3xl">📚</span>
              <div>
                <h3 className="text-xl font-bold text-amber-900">Semua Bidang</h3>
                <p className="text-gray-500 text-sm mt-0.5">{fields.length} bidang tersedia</p>
              </div>
            </div>
            <div className="pl-4 border-l-2 border-amber-200 ml-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {fields.map(f => (
                  <div key={f.id} className="flex gap-2">
                    <div className="w-4 h-0.5 bg-amber-200 mt-5 shrink-0" />
                    <div className="flex-1"><FieldCard field={f} /></div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

