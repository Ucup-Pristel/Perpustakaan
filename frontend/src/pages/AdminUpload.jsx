import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ImagePlus, Loader2, Trash2, UploadCloud } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { API_URL } from '../lib/api'

const SUB_FIELDS = [
  { id: 1,  name: 'Pemasaran',                field: 'Manajemen' },
  { id: 2,  name: 'Sumber Daya Manusia',       field: 'Manajemen' },
  { id: 3,  name: 'Rekayasa Perangkat Lunak',  field: 'Teknologi' },
  { id: 4,  name: 'Ilmu Data',                 field: 'Teknologi' },
  { id: 5,  name: 'Kedokteran Umum',           field: 'Kesehatan' },
  { id: 6,  name: 'Pendidikan Anak Usia Dini', field: 'Pendidikan' },
  { id: 7,  name: 'Desain Grafis',             field: 'Seni & Kreativitas' },
  { id: 8,  name: 'Teknik Komputer',           field: 'Teknologi' },
]

const LEVELS = [
  { value: 1, label: 'Pemula' },
  { value: 2, label: 'Menengah' },
  { value: 3, label: 'Lanjutan' },
  { value: 4, label: 'Ahli' },
]

const INIT = { title: '', author: '', description: '', sub_field_id: '', level: '1', language: 'id' }

export default function AdminUpload() {
  const { token } = useAuth()
  const pdfRef    = useRef(null)
  const coverRef  = useRef(null)

  const [form,        setForm]        = useState(INIT)
  const [pdfFile,     setPdfFile]     = useState(null)
  const [coverFile,   setCoverFile]   = useState(null)
  const [coverPreview, setCoverPreview] = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [toast,       setToast]       = useState(null)
  const [contents,    setContents]    = useState([])
  const [listLoading, setListLoading] = useState(true)

  const authHeaders = { Authorization: `Bearer ${token}` }

  async function loadContents() {
    setListLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/admin/contents`, { headers: authHeaders })
      const json = await res.json()
      if (res.ok) setContents(json.data || [])
    } finally {
      setListLoading(false)
    }
  }

  useEffect(() => { loadContents() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function set(key) { return e => setForm(prev => ({ ...prev, [key]: e.target.value })) }

  function handleCoverChange(e) {
    const f = e.target.files[0] || null
    setCoverFile(f)
    if (coverPreview) URL.revokeObjectURL(coverPreview)
    setCoverPreview(f ? URL.createObjectURL(f) : null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!pdfFile) return showToast('err', 'Pilih file PDF terlebih dahulu.')
    if (!form.title.trim()) return showToast('err', 'Judul diperlukan.')

    const fd = new FormData()
    fd.append('pdf', pdfFile)
    if (coverFile) fd.append('cover', coverFile)
    Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v) })

    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/admin/upload`, { method: 'POST', headers: authHeaders, body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message)
      showToast('ok', `Upload berhasil! ID: ${json.data.id}`)
      setForm(INIT)
      setPdfFile(null);  if (pdfRef.current)   pdfRef.current.value   = ''
      setCoverFile(null); if (coverRef.current) coverRef.current.value = ''
      if (coverPreview) { URL.revokeObjectURL(coverPreview); setCoverPreview(null) }
      loadContents()
    } catch (err) {
      showToast('err', err.message || 'Upload gagal.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id, title) {
    if (!window.confirm(`Hapus "${title}"?`)) return
    const res = await fetch(`${API_URL}/api/admin/contents/${id}`, { method: 'DELETE', headers: authHeaders })
    const json = await res.json()
    if (res.ok) { showToast('ok', 'Konten dihapus.'); loadContents() }
    else showToast('err', json.message)
  }

  function showToast(type, msg) {
    setToast({ type, msg })
    window.setTimeout(() => setToast(null), 4000)
  }

  const fileInputClass = 'block w-full text-sm text-amber-900 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-100 file:text-amber-800 hover:file:bg-amber-200 cursor-pointer'

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-10">

      {toast && (
        <div className={`fixed top-20 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold ${toast.type === 'ok' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-amber-900">Admin Backoffice</h1>
          <p className="text-sm text-amber-700 mt-0.5">Upload PDF dan kelola konten perpustakaan</p>
        </div>
        <Link to="/" className="text-xs text-amber-700 hover:underline">← Kembali ke Beranda</Link>
      </div>

      {/* Upload Form */}
      <section className="bg-white rounded-2xl border border-amber-100 shadow-sm p-6">
        <h2 className="text-lg font-bold text-amber-900 mb-5 flex items-center gap-2">
          <UploadCloud className="w-5 h-5" /> Upload Konten Baru
        </h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* PDF */}
          <div>
            <label className="block text-xs font-semibold text-amber-800 mb-1">
              File PDF <span className="text-red-500">*</span>
            </label>
            <input ref={pdfRef} type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files[0] || null)} className={fileInputClass} />
          </div>

          {/* Cover */}
          <div>
            <label className="block text-xs font-semibold text-amber-800 mb-1">
              Sampul Buku <span className="text-gray-400 font-normal">(opsional)</span>
            </label>
            <input ref={coverRef} type="file" accept="image/*" onChange={handleCoverChange} className={fileInputClass} />
          </div>

          {/* Cover preview */}
          {coverPreview && (
            <div className="sm:col-span-2 flex items-start gap-3">
              <img src={coverPreview} alt="preview sampul" className="h-28 w-20 object-cover rounded-lg border border-amber-200 shadow-sm" />
              <p className="text-xs text-amber-700 mt-1">Preview sampul</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-amber-800 mb-1">Judul <span className="text-red-500">*</span></label>
            <input value={form.title} onChange={set('title')} placeholder="Judul buku" className="field" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-amber-800 mb-1">Penulis / Author</label>
            <input value={form.author} onChange={set('author')} placeholder="Nama penulis" className="field" />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-amber-800 mb-1">Deskripsi</label>
            <textarea value={form.description} onChange={set('description')} rows={3} placeholder="Deskripsi singkat konten" className="field resize-none" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-amber-800 mb-1">Bidang / Sub-bidang</label>
            <select value={form.sub_field_id} onChange={set('sub_field_id')} className="field">
              <option value="">— Pilih Sub-bidang —</option>
              {SUB_FIELDS.map(sf => (
                <option key={sf.id} value={sf.id}>{sf.field} → {sf.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-amber-800 mb-1">Level</label>
            <select value={form.level} onChange={set('level')} className="field">
              {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-amber-800 mb-1">Bahasa</label>
            <select value={form.language} onChange={set('language')} className="field">
              <option value="id">Indonesia</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="sm:col-span-2 flex justify-end">
            <button type="submit" disabled={loading}
              className="flex items-center gap-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {loading ? 'Mengupload…' : 'Upload ke R2'}
            </button>
          </div>
        </form>
      </section>

      {/* Content Table */}
      <section className="bg-white rounded-2xl border border-amber-100 shadow-sm p-6">
        <h2 className="text-lg font-bold text-amber-900 mb-5 flex items-center gap-2">
          <BookOpen className="w-5 h-5" /> Daftar Konten ({contents.length})
        </h2>
        {listLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-600" /></div>
        ) : contents.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">Belum ada konten.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-100 text-left text-xs text-amber-700 uppercase tracking-wide">
                  <th className="pb-2 pr-3">Sampul</th>
                  <th className="pb-2 pr-4">ID</th>
                  <th className="pb-2 pr-4">Judul</th>
                  <th className="pb-2 pr-4">Penulis</th>
                  <th className="pb-2 pr-4">Bidang</th>
                  <th className="pb-2 pr-4">Tipe</th>
                  <th className="pb-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {contents.map(c => (
                  <tr key={c.id} className="border-b border-amber-50 hover:bg-amber-50/50">
                    <td className="py-2 pr-3">
                      {c.cover_url
                        ? <img src={c.cover_url} alt={c.title} className="h-10 w-7 object-cover rounded shadow-sm" />
                        : <div className="h-10 w-7 rounded bg-amber-50 flex items-center justify-center"><ImagePlus className="w-3.5 h-3.5 text-amber-300" /></div>
                      }
                    </td>
                    <td className="py-2 pr-4 text-gray-400 tabular-nums">{c.id}</td>
                    <td className="py-2 pr-4 font-medium text-amber-900 max-w-xs truncate">
                      <Link to={`/read/${c.id}`} className="hover:underline">{c.title}</Link>
                    </td>
                    <td className="py-2 pr-4 text-gray-600 max-w-[120px] truncate">{c.author || '—'}</td>
                    <td className="py-2 pr-4 text-gray-600 text-xs">{c.sub_field_name || '—'}</td>
                    <td className="py-2 pr-4"><span className="uppercase text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{c.content_type || '—'}</span></td>
                    <td className="py-2">
                      <button onClick={() => handleDelete(c.id, c.title)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
