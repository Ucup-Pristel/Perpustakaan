import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import {
  AlertCircle, BookOpen, CheckCircle2, ChevronLeft,
  Loader2, PanelRightClose, PanelRightOpen, Send, StickyNote, X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

function PdfPage({ page, activePage, pageWidth, setPageRef }) {
  const renderPage = pageWidth > 0 && Math.abs(page - activePage) <= 2

  return (
    <section
      ref={element => setPageRef(page, element)}
      data-page={page}
      className="flex min-h-[860px] w-full scroll-mt-6 flex-col items-center justify-center rounded-2xl bg-white p-4 shadow-lg sm:p-6"
    >
      {renderPage ? <Page pageNumber={page} width={pageWidth} renderTextLayer renderAnnotationLayer /> : <span className="text-sm text-amber-400">Halaman {page}</span>}
    </section>
  )
}

export default function Reader() {
  const { contentId } = useParams()
  const navigate = useNavigate()
  const { token } = useAuth()
  const cid = Number(contentId)
  const [content, setContent] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [savedPage, setSavedPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [notes, setNotes] = useState([])
  const [noteText, setNoteText] = useState('')
  const [notesLoading, setNotesLoading] = useState(true)
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesError, setNotesError] = useState('')
  const [containerWidth, setContainerWidth] = useState(0)
  const readerRef = useRef(null)
  const documentRef = useRef(null)
  const pageRefs = useRef({})
  const restoredPage = useRef(1)

  useEffect(() => {
    if (!Number.isInteger(cid) || cid < 1) {
      setError('Konten tidak valid')
      setLoading(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [contentJson, progressJson] = await Promise.all([
          apiFetch(`/api/contents/${cid}`, { signal: controller.signal }),
          // Progress gagal (mis. sesi berakhir) tidak boleh menghalangi PDF
          // terbuka. apiFetch tetap memicu logout global saat 401.
          token
            ? apiFetch(`/api/activity/reading-progress/${cid}`, { token, signal: controller.signal }).catch(() => null)
            : Promise.resolve(null),
        ])
        if (!contentJson.data.file_url || contentJson.data.content_type !== 'pdf') throw new Error('Konten ini belum memiliki file PDF')
        if (cancelled) return
        const saved = Math.max(1, Number(progressJson?.data?.last_page_read) || 1)
        restoredPage.current = saved
        setContent(contentJson.data)
        setSavedPage(saved)
        setPageNumber(saved)
      } catch (err) {
        if (!cancelled && err.name !== 'AbortError') setError(err.message || 'Gagal memuat konten')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true; controller.abort() }
  }, [cid, token])

  useEffect(() => {
    if (!token || !Number.isInteger(cid) || cid < 1) {
      setNotes([])
      setNotesLoading(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setNotesLoading(true)
    apiFetch(`/api/activity/notes/${cid}?page_number=${pageNumber}`, { token, signal: controller.signal })
      .then(json => {
        if (cancelled) return
        const note = json.data?.[0]
        setNotes(note ? [note] : [])
        setNoteText(note?.note_text || '')
      })
      .catch(() => { if (!cancelled) setNotes([]) })
      .finally(() => { if (!cancelled) setNotesLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [cid, pageNumber, token])

  const saveProgress = useCallback(async page => {
    if (!token || page === savedPage) return
    setSaving(true)
    setSaveMsg('')
    try {
      await apiFetch('/api/activity/reading-progress', {
        method: 'POST',
        token,
        body: JSON.stringify({ content_id: cid, last_page: page }),
      })
      setSavedPage(page)
      setSaveMsg('ok')
      window.setTimeout(() => setSaveMsg(''), 2000)
    } catch {
      setSaveMsg('err')
    } finally {
      setSaving(false)
    }
  }, [cid, savedPage, token])

  useEffect(() => {
    if (!token || !numPages || pageNumber === savedPage) return
    const timer = window.setTimeout(() => saveProgress(pageNumber), 600)
    return () => window.clearTimeout(timer)
  }, [numPages, pageNumber, savedPage, saveProgress, token])

  const setPageRef = useCallback((page, element) => {
    if (element) pageRefs.current[page] = element
    else delete pageRefs.current[page]
  }, [])

  useEffect(() => {
    const element = documentRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(Math.max(0, Math.floor(entry.contentRect.width - 32)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [content])

  useEffect(() => {
    if (!numPages || !readerRef.current) return
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (visible) setPageNumber(Number(visible.target.dataset.page))
    }, { root: readerRef.current, threshold: [0.5] })

    Object.values(pageRefs.current).forEach(element => observer.observe(element))
    return () => observer.disconnect()
  }, [numPages])

  function onDocumentLoadSuccess({ numPages: total }) {
    setNumPages(total)
    const page = Math.min(restoredPage.current, total)
    requestAnimationFrame(() => pageRefs.current[page]?.scrollIntoView({ block: 'start' }))
  }

  async function submitNote(event) {
    event.preventDefault()
    const text = noteText.trim()
    if (!text || !token) return
    setNotesSaving(true)
    setNotesError('')
    try {
      const json = await apiFetch('/api/activity/notes', {
        method: 'POST',
        token,
        body: JSON.stringify({ content_id: cid, page_number: pageNumber, note_text: text }),
      })
      setNotes([json.data])
      setNoteText(json.data.note_text)
    } catch (err) {
      setNotesError(err.message || 'Gagal menyimpan catatan')
    } finally {
      setNotesSaving(false)
    }
  }

  const progressPct = numPages ? Math.round((pageNumber / numPages) * 100) : 0

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-amber-50">
      <header className="flex shrink-0 items-center gap-3 border-b border-amber-100 bg-white px-4 py-2 shadow-sm">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-amber-700 hover:text-amber-900"><ChevronLeft size={18} /> Kembali</button>
        <div className="flex min-w-0 flex-1 items-center gap-2"><BookOpen size={18} className="shrink-0 text-amber-600" /><span className="truncate text-sm font-semibold text-amber-900">{content?.title || `Konten #${cid}`}</span></div>
        <div className="flex shrink-0 items-center gap-2">
          {saving && <Loader2 size={14} className="animate-spin text-amber-500" />}
          {saveMsg === 'ok' && <CheckCircle2 size={14} className="text-green-500" />}
          {saveMsg === 'err' && <AlertCircle size={14} className="text-red-500" />}
          <span className="hidden text-xs text-amber-600 sm:block">Hal. {pageNumber}/{numPages || '-'}</span>
          <div className="h-2 w-24 overflow-hidden rounded-full bg-amber-100"><div className="h-full rounded-full bg-amber-500" style={{ width: `${progressPct}%` }} /></div>
          <span className="w-8 text-right text-xs font-medium text-amber-700">{progressPct}%</span>
        </div>
        <button onClick={() => setSidebarOpen(open => !open)} className="ml-2 rounded-lg p-1.5 text-amber-600 hover:bg-amber-100" title={sidebarOpen ? 'Tutup panel catatan' : 'Buka panel catatan'}>{sidebarOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main ref={readerRef} className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
          {loading && <div className="flex justify-center pt-20"><Loader2 className="animate-spin text-amber-600" /></div>}
          {error && <div className="mx-auto max-w-2xl rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
          {!loading && !error && content && (
            <Document file={content.file_url} onLoadSuccess={onDocumentLoadSuccess} loading={<div className="flex justify-center py-20"><Loader2 className="animate-spin text-amber-600" /></div>} error={<p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">PDF gagal dimuat. Pastikan file dapat diakses dari browser.</p>}>
              <div ref={documentRef} className="mx-auto flex w-full max-w-5xl flex-col gap-2">
                {Array.from({ length: numPages }, (_, index) => <PdfPage key={index + 1} page={index + 1} activePage={pageNumber} pageWidth={containerWidth} setPageRef={setPageRef} />)}
              </div>
            </Document>
          )}
        </main>

        <aside className={`flex shrink-0 flex-col overflow-hidden border-l border-amber-100 bg-white transition-all duration-300 ${sidebarOpen ? 'w-80' : 'w-0'}`}>
          <div className="flex h-full w-80 flex-col">
            <div className="shrink-0 border-b border-amber-100 px-4 py-3"><div className="flex items-center gap-2"><StickyNote size={16} className="text-amber-600" /><span className="text-sm font-semibold text-amber-900">Catatan untuk halaman {pageNumber}</span></div></div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {notesLoading ? <div className="flex justify-center pt-8"><Loader2 size={20} className="animate-spin text-amber-400" /></div> : notes.length === 0 ? <p className="pt-8 text-center text-xs text-amber-400">Belum ada catatan.</p> : notes.map(note => <div key={note.id} className="rounded-xl border border-amber-100 bg-amber-50 p-3"><div className="mb-1 flex items-center gap-1"><span className="rounded bg-amber-200 px-1.5 py-0.5 font-mono text-[10px] text-amber-700">Hal. {note.page_number}</span><span className="ml-auto text-[10px] text-amber-400">{note.created_at ? new Date(note.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) : '--'}</span></div><p className="text-sm leading-relaxed text-amber-900">{note.note_text}</p></div>)}
            </div>
            <form onSubmit={submitNote} className="shrink-0 border-t border-amber-100 p-4">
              {notesError && <div className="mb-2 flex items-center gap-1.5 text-xs text-red-600"><AlertCircle size={12} />{notesError}<button type="button" onClick={() => setNotesError('')} className="ml-auto"><X size={12} /></button></div>}
              <p className="mb-1.5 text-[10px] text-amber-400">Catatan untuk halaman {pageNumber}</p>
              <textarea value={noteText} onChange={event => setNoteText(event.target.value)} placeholder="Tulis catatanmu..." rows={3} className="w-full resize-none rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 placeholder-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <button type="submit" disabled={!noteText.trim() || notesSaving || !token} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:bg-amber-200">{notesSaving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Simpan Catatan</button>
              {!token && <p className="mt-1 text-center text-[10px] text-amber-400">Login untuk menyimpan catatan</p>}
            </form>
          </div>
        </aside>
      </div>
    </div>
  )
}
