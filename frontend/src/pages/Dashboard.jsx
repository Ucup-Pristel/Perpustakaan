import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, ChevronRight, FileText, Loader2, StickyNote } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { API_URL } from '../lib/api'

function formatDate(value) {
  return value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(value)) : ''
}

export default function Dashboard() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [summary, setSummary] = useState({ recent_reads: [], my_notes: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true })
      return
    }

    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`${API_URL}/api/activity/summary`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.message || 'Gagal memuat dashboard')
        if (!cancelled) setSummary(json.data || { recent_reads: [], my_notes: [] })
      } catch (err) {
        if (!cancelled) setError(err.message || 'Gagal memuat dashboard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [navigate, token])

  if (loading) {
    return <main className="min-h-screen bg-orange-50 flex justify-center pt-24"><Loader2 className="animate-spin text-amber-600" /></main>
  }

  return (
    <main className="min-h-screen bg-orange-50 px-4 py-8 sm:px-6">
      <div className="max-w-6xl mx-auto">
        <header className="bg-gradient-to-br from-amber-800 to-orange-700 rounded-2xl px-6 py-8 text-white mb-8">
          <p className="text-amber-200 text-xs uppercase tracking-widest">Dashboard belajar</p>
          <h1 className="text-2xl sm:text-3xl font-bold mt-1">Halo, {user?.full_name || user?.email || 'Pengguna'}</h1>
          <p className="text-amber-100 mt-2 text-sm">Lanjutkan bacaan dan lihat semua catatanmu.</p>
        </header>

        {error && <p className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</p>}

        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4 text-amber-900">
            <BookOpen size={22} />
            <h2 className="text-xl font-bold">Terakhir Dibaca</h2>
          </div>
          {summary.recent_reads.length === 0 ? (
            <Empty icon={<BookOpen size={24} />} text="Belum ada bacaan. Mulai eksplorasi materi untuk menyimpan progres." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {summary.recent_reads.map(item => (
                <article key={item.content_id} className="bg-white rounded-2xl border border-orange-100 shadow-sm p-5 flex flex-col">
                  <span className="text-xs font-semibold text-amber-700">Level {item.level || '-'}</span>
                  <h3 className="font-bold text-amber-900 mt-2">{item.title}</h3>
                  <p className="text-sm text-gray-600 mt-1">{item.author || 'Materi ucup-edu-lib'}</p>
                  <p className="text-xs text-gray-500 mt-3">Terakhir dibaca {formatDate(item.updated_at)}</p>
                  <Link to={`/read/${item.content_id}`} className="mt-4 inline-flex items-center justify-center gap-1 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600">
                    Lanjutkan <ChevronRight size={16} />
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4 text-amber-900">
            <StickyNote size={22} />
            <h2 className="text-xl font-bold">Koleksi Catatan</h2>
          </div>
          {summary.my_notes.length === 0 ? (
            <Empty icon={<StickyNote size={24} />} text="Belum ada catatan. Tambahkan catatan saat membaca materi." />
          ) : (
            <div className="space-y-4">
              {summary.my_notes.map(note => (
                <article key={note.id} className="bg-white rounded-2xl border border-orange-100 shadow-sm p-5">
                  <div className="flex gap-3">
                    <FileText className="text-amber-600 shrink-0 mt-0.5" size={20} />
                    <div className="min-w-0">
                      <Link to={`/read/${note.content_id}`} className="font-bold text-amber-900 hover:text-amber-600">{note.title}</Link>
                      <p className="text-xs text-amber-700 mt-1">Halaman {note.page_number} · {formatDate(note.created_at)}</p>
                      <p className="text-gray-700 mt-3 whitespace-pre-wrap">{note.note_text}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function Empty({ icon, text }) {
  return (
    <div className="rounded-2xl border border-dashed border-amber-200 bg-white p-8 text-center text-gray-500">
      <div className="text-amber-500 flex justify-center mb-3">{icon}</div>
      <p>{text}</p>
      <Link to="/" className="inline-flex items-center gap-1 mt-4 text-sm font-medium text-amber-700 hover:text-amber-900">Cari materi <ChevronRight size={16} /></Link>
    </div>
  )
}
