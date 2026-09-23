import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, ChevronRight, Loader2, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

/**
 * pct null = jumlah halaman tidak diketahui, jadi persentase TIDAK ditampilkan.
 *
 * Dulu progress dihitung dengan divisor hardcoded `/22`, seolah setiap buku
 * 22 halaman — salah untuk hampir semua konten. Sekarang dipakai page_count
 * dari server; saat kolom itu masih kosong (kondisi DB sekarang), yang
 * ditampilkan hanya halaman terakhir, bukan persen yang dikarang.
 */
function Progress({ pct, lastPage }) {
  if (pct === null) {
    if (!lastPage) return null
    return <p className="mt-4 text-xs text-amber-700">Terakhir dibaca: halaman {lastPage}</p>
  }
  const safe = Math.max(0, Math.min(100, pct))
  return (
    <div className="mt-4">
      <div className="flex justify-between text-xs text-amber-700 mb-1">
        <span>Progress bacaan</span><span>{safe}%</span>
      </div>
      <div className="h-2 bg-amber-100 rounded-full overflow-hidden">
        <div className="h-full bg-amber-500 rounded-full" style={{ width: `${safe}%` }} />
      </div>
    </div>
  )
}

export default function ContentList() {
  const { fieldId } = useParams()
  const { token } = useAuth()
  const [contents, setContents] = useState([])
  const [field, setField] = useState(null)
  const [progress, setProgress] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [contentJson, fieldsJson] = await Promise.all([
          apiFetch(`/api/contents?field_id=${encodeURIComponent(fieldId)}`, { signal: controller.signal }),
          // Daftar bidang hanya untuk judul halaman — gagal di sini tidak
          // boleh menggagalkan daftar konten.
          apiFetch('/api/fields', { signal: controller.signal }).catch(() => null),
        ])
        if (cancelled) return
        setContents(contentJson.data || [])
        setField((fieldsJson?.data || []).find(item => String(item.id) === String(fieldId)) || null)

        if (token && contentJson.data?.length) {
          // ponytail: masih satu request per konten (N+1). Batasi ke endpoint
          // batch kalau daftar per bidang tumbuh besar.
          // .catch per item: satu progress gagal tidak boleh menggagalkan
          // seluruh halaman (dulu Promise.all ikut reject).
          const entries = await Promise.all(contentJson.data.map(async content => {
            const json = await apiFetch(`/api/activity/progress/${content.id}`, {
              token, signal: controller.signal,
            }).catch(() => null)
            return [content.id, json?.data?.last_page_read || 0]
          }))
          if (!cancelled) setProgress(Object.fromEntries(entries))
        }
      } catch (err) {
        if (!cancelled && err.name !== 'AbortError') setError(err.message || 'Gagal memuat data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true; controller.abort() }
  }, [fieldId, token])

  return (
    <main className="min-h-screen bg-orange-50 px-4 sm:px-6 py-8">
      <div className="max-w-6xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-amber-700 hover:text-amber-900 mb-6">
          <ArrowLeft size={16} /> Kembali ke bidang
        </Link>

        <div className="bg-gradient-to-br from-amber-800 to-orange-700 text-white rounded-2xl px-6 py-8 mb-8">
          <div className="flex items-center gap-3">
            <span className="text-4xl">{field?.icon || '📚'}</span>
            <div>
              <p className="text-amber-200 text-xs uppercase tracking-widest">Materi pembelajaran</p>
              <h1 className="text-2xl sm:text-3xl font-bold">{field?.name || `Bidang #${fieldId}`}</h1>
            </div>
          </div>
          {field?.description && <p className="mt-4 text-amber-100 max-w-2xl text-sm">{field.description}</p>}
        </div>

        {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-amber-600" /></div>}
        {error && <div className="flex gap-2 items-center bg-red-50 border border-red-200 text-red-700 rounded-xl p-4"><AlertTriangle size={18} />{error}</div>}
        {!loading && !error && contents.length === 0 && <p className="text-center text-gray-500 py-16">Belum ada materi di bidang ini.</p>}

        {!loading && !error && contents.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {contents.map(content => {
              const lastPage = Number(progress[content.id]) || 0
              const totalPages = Number(content.page_count) || 0
              // Persen hanya dihitung kalau page_count diketahui. Divisor tetap
              // (dulu /22) menghasilkan angka yang salah untuk hampir semua buku.
              const pct = totalPages > 0 ? Math.round((lastPage / totalPages) * 100) : null
              return (
                <article key={content.id} className="bg-white rounded-2xl border border-orange-100 shadow-sm p-5 flex flex-col hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-amber-100 text-amber-700"><BookOpen size={20} /></div>
                    <div className="min-w-0"><h2 className="font-bold text-amber-900 leading-snug">{content.title}</h2><p className="text-xs text-amber-600 mt-1">{content.author || 'Materi ucup-edu-lib'}</p></div>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed mt-4 flex-1">{content.description || 'Materi pembelajaran untuk memperluas wawasanmu.'}</p>
                  <Progress pct={pct} lastPage={lastPage} />
                  {/* Reader hanya bisa membuka PDF yang punya file_url. Dulu semua
                      konten diarahkan ke /read/:id, jadi ebook tanpa file dibuka
                      lalu langsung menampilkan error. */}
                  {content.content_type === 'pdf' && content.file_url ? (
                    <Link to={`/read/${content.id}`} className="mt-4 inline-flex justify-center items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-2 text-sm font-medium">
                      Buka materi <ChevronRight size={16} />
                    </Link>
                  ) : content.source_url ? (
                    <a href={content.source_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex justify-center items-center gap-1 rounded-lg border border-amber-300 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50">
                      Buka sumber eksternal <ChevronRight size={16} />
                    </a>
                  ) : (
                    <p className="mt-4 rounded-lg bg-gray-50 py-2 text-center text-xs text-gray-500">
                      Materi belum tersedia
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
