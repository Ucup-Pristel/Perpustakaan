import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ImagePlus, Loader2, Trash2, UploadCloud } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

// Daftar sub-bidang TIDAK di-hardcode lagi: ID di sini dulu ditebak (1-8) dan
// dikirim apa adanya ke server. Setelah reseed/migration, ID bisa bergeser,
// jadi upload bisa masuk kategori yang salah. Sekarang diambil dari
// /api/subfields, dan backend juga memverifikasi ID-nya benar-benar ada.

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
  const [subFields,   setSubFields]   = useState([])
  // id konten yang sedang menunggu upload cover — dipakai untuk menonaktifkan
  // tombol baris itu saja, bukan seluruh tabel.
  const [coverBusyId, setCoverBusyId] = useState(null)

  // Dideklarasikan SEBELUM pemakaian pertama (loadContents di bawah).
  // Function declaration memang di-hoist, tapi urutan terbalik memicu warning
  // react(immutability) di oxlint.
  function showToast(type, msg) {
    setToast({ type, msg })
    window.setTimeout(() => setToast(null), 4000)
  }

  async function loadContents() {
    setListLoading(true)
    try {
      const json = await apiFetch('/api/admin/contents', { token })
      setContents(json.data || [])
    } catch (err) {
      // Dulu error ditelan diam-diam (`if (res.ok)`), jadi tabel kosong
      // tanpa penjelasan. Sekarang penyebabnya ditampilkan.
      showToast('err', err.message || 'Gagal memuat daftar konten')
    } finally {
      setListLoading(false)
    }
  }

  useEffect(() => { loadContents() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sub-bidang diambil dari server, bukan daftar hardcoded. Publik, jadi tanpa token.
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    apiFetch('/api/subfields', { signal: controller.signal })
      .then(json => { if (!cancelled) setSubFields(json.data || []) })
      .catch(err => {
        if (!cancelled && err.name !== 'AbortError') {
          showToast('err', `Gagal memuat daftar sub-bidang: ${err.message}`)
        }
      })
    return () => { cancelled = true; controller.abort() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      // body FormData: apiFetch sengaja tidak menyetel Content-Type supaya
      // browser yang menentukan boundary multipart.
      const json = await apiFetch('/api/admin/upload', { method: 'POST', token, body: fd })
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

  // Memakai POST /api/admin/contents/:id/cover yang sudah ada di backend tapi
  // belum pernah dipanggil dari mana pun. Cover lama di R2 dihapus oleh backend.
  async function handleReplaceCover(id, file) {
    if (!file) return
    setCoverBusyId(id)
    try {
      const fd = new FormData()
      fd.append('cover', file)
      await apiFetch(`/api/admin/contents/${id}/cover`, { method: 'POST', token, body: fd })
      showToast('ok', 'Sampul diperbarui.')
      loadContents()
    } catch (err) {
      showToast('err', err.message || 'Gagal memperbarui sampul')
    } finally {
      setCoverBusyId(null)
    }
  }

  async function handleDelete(id, title) {
    if (!window.confirm(`Hapus "${title}"?`)) return
    try {
      await apiFetch(`/api/admin/contents/${id}`, { method: 'DELETE', token })
      showToast('ok', 'Konten dihapus.')
      loadContents()
    } catch (err) {
      showToast('err', err.message || 'Gagal menghapus konten')
    }
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
              <option value="">
                {subFields.length ? '— Pilih Sub-bidang —' : '— Memuat sub-bidang… —'}
              </option>
              {subFields.map(sf => (
                <option key={sf.id} value={sf.id}>{sf.field_name} → {sf.name}</option>
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
                      <div className="flex items-center gap-1">
                        {/* <label> membungkus input file tersembunyi: memberi area
                            klik yang bisa difokus tanpa perlu ref per baris.
                            value direset setelah pilih supaya memilih file yang
                            sama dua kali tetap memicu onChange. */}
                        <label
                          className={`p-1.5 rounded-lg transition ${
                            coverBusyId === c.id
                              ? 'text-amber-300 cursor-wait'
                              : 'text-amber-500 hover:bg-amber-50 hover:text-amber-700 cursor-pointer'
                          }`}
                          title={c.cover_url ? 'Ganti sampul' : 'Tambah sampul'}
                        >
                          {coverBusyId === c.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <ImagePlus className="w-4 h-4" />}
                          <span className="sr-only">
                            {c.cover_url ? `Ganti sampul ${c.title}` : `Tambah sampul ${c.title}`}
                          </span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png"
                            className="hidden"
                            disabled={coverBusyId === c.id}
                            onChange={e => {
                              const f = e.target.files[0] || null
                              e.target.value = ''
                              handleReplaceCover(c.id, f)
                            }}
                          />
                        </label>
                        <button
                          onClick={() => handleDelete(c.id, c.title)}
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition"
                          title="Hapus konten"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="sr-only">Hapus {c.title}</span>
                        </button>
                      </div>
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
