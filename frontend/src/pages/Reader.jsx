import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

const RESIZE_SETTLE_MS = 150
const NOTES_DEBOUNCE_MS = 300
// Halaman dalam ±PROTECT dari halaman aktif (area terlihat + cadangan) selalu
// ter-mount dan tidak pernah dilepas. Juga dipakai untuk pengukuran awal dan
// sebagai jangkauan awal setelah buka buku atau lompat jauh.
const PROTECT = 2
// Arah baca normal ke depan. Buffer depan dua tingkat:
// - IMMEDIATE_AHEAD halaman di depan langsung di-mount (frame berikutnya, tanpa
//   menunggu idle), supaya selalu ada beberapa halaman siap di depan pembaca;
// - sampai AHEAD halaman disiapkan bertahap AHEAD_BATCH per browser idle.
// Scroll maju satu halaman hanya menambah satu render baru, ~6+ viewport di depan.
const IMMEDIATE_AHEAD = 6
const AHEAD = 10
const AHEAD_BATCH = 2
// Batas halaman ter-mount (canvas PDF). Jendela = 2 di belakang + aktif + 10 di
// depan = 13; 3 slot sisanya menahan halaman yang baru dilewati (total ±5 di
// belakang), jadi scroll bolak-balik di sekitarnya tidak me-mount ulang canvas.
// ponytail: memori canvas ≈ MAX_RESIDENT × lebar × tinggi × DPR² × 4 byte
// (±340 MB terburuk di lebar 992px DPR 2, ±190 MB di DPR 1.5, ±85 MB di DPR 1).
// Turunkan AHEAD / MAX_RESIDENT bila perangkat memori kecil mulai tersendat.
const MAX_RESIDENT = 16
// Rasio halaman diukur bertahap di latar belakang, sekian halaman per batch.
const MEASURE_BATCH = 24
// ponytail: batas DPR 2 menahan memori canvas di layar DPR 3. Naikkan bila
// teks terasa kurang tajam di ponsel kelas atas.
const MAX_DPR = 2
// Canvas dirender di lebar ini lalu diskalakan CSS ke lebar slot, supaya
// buka/tutup sidebar tidak memaksa render ulang (canvas disembunyikan
// react-pdf selama render → halaman berkedip). Render ulang hanya bila slot
// melebar atau menyusut di bawah batas ini.
const MIN_RENDER_SCALE = 0.7
// Lebar halaman maksimum = max-w-5xl (1024) − padding slot (32).
const MAX_PAGE_WIDTH = 992
// Lebar sidebar catatan (w-80).
const SIDEBAR_WIDTH = 320

// Slot halaman selalu setinggi halaman aslinya (lebar × rasio halaman), baik
// canvas ter-render maupun placeholder. Tanpa ini, perpindahan jendela render
// mengubah tinggi dokumen saat scroll → halaman lompat/berkedip.
const PdfPage = memo(function PdfPage({ page, render, pageWidth, renderWidth, ratio, setPageRef }) {
  // Siap = onRenderSuccess untuk lebar canvas saat ini. Ter-mount ≠ siap.
  const [readyWidth, setReadyWidth] = useState(0)
  if (!render && readyWidth) setReadyWidth(0)
  const ready = render && readyWidth === renderWidth
  return (
    <section
      ref={element => setPageRef(page, element)}
      data-page={page}
      data-ready={ready ? '' : undefined}
      className="flex w-full scroll-mt-6 flex-col items-center rounded-2xl bg-white p-4 shadow-lg sm:p-6"
    >
      <div className="relative flex items-center justify-center overflow-hidden" style={{ width: pageWidth, height: Math.floor(pageWidth * ratio) }}>
        <span className="text-sm text-amber-400">Halaman {page}</span>
        {render && (
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: renderWidth, transform: `scale(${pageWidth / renderWidth})` }}>
            <Page
              pageNumber={page}
              width={renderWidth}
              devicePixelRatio={Math.min(MAX_DPR, window.devicePixelRatio || 1)}
              loading={null}
              // Default react-pdf: <Page> baru men-suspend sampai page proxy
              // siap → Suspense level route (App.jsx) mengganti SELURUH Reader
              // dengan spinner. Tanpa suspense, placeholder di belakang tetap
              // tampil sampai canvas selesai.
              suspense={false}
              onRenderSuccess={() => setReadyWidth(renderWidth)}
              onRenderError={() => setReadyWidth(0)}
              renderTextLayer
              renderAnnotationLayer
            />
          </div>
        )}
      </div>
    </section>
  )
})

// Set halaman ter-mount: Map halaman → tick terakhir berada di jendela.
// Jendela [aktif − PROTECT, aktif + reach] ditambahkan/diperbarui. Bila melebihi
// MAX_RESIDENT, hanya halaman di luar jendela yang boleh dilepas: yang paling
// jauh dari halaman aktif lebih dulu (seri: yang paling lama tidak terlihat).
// Jendela ≤ 13 < MAX_RESIDENT, jadi jendela sendiri tidak pernah terpotong.
function nextResident(prev, active, total, tick, reach) {
  const lo = Math.max(1, active - PROTECT)
  const hi = Math.min(total, active + reach)
  const pages = new Map(prev)
  for (const page of pages.keys()) if (page > total) pages.delete(page)
  for (let page = lo; page <= hi; page++) pages.set(page, tick)
  const excess = pages.size - MAX_RESIDENT
  if (excess > 0) {
    const distance = page => Math.abs(page - active)
    const evictable = [...pages]
      .filter(([page]) => page < lo || page > hi)
      .sort((a, b) => distance(b[0]) - distance(a[0]) || a[1] - b[1])
    for (const [page] of evictable.slice(0, excess)) pages.delete(page)
  }
  return pages
}

// Lebar canvas: pakai lebar terlebar yang mungkin (sidebar tertutup) supaya
// buka/tutup sidebar cukup menskalakan CSS. Render ulang hanya bila slot lebih
// lebar dari canvas atau jauh lebih sempit (hemat memori).
function nextRenderWidth(prev, width, widest) {
  if (prev && width <= prev && width >= prev * MIN_RENDER_SCALE) return prev
  return width >= widest * MIN_RENDER_SCALE ? Math.max(width, widest) : width
}

// Ukur rasio tinggi/lebar halaman. Satu getPage() per halaman per sesi:
// promise disimpan di `pending` sehingga pengukuran yang tumpang-tindih (jendela
// render + antrean latar belakang) memakai hasil yang sama. pdf.js juga
// meng-cache PDFPageProxy, jadi <Page> nanti tidak meminta ulang ke worker.
function measureRatios(pdf, pages, { pending, ratios }) {
  return Promise.all(pages.map(page => {
    if (!pending.has(page)) {
      pending.set(page, pdf.getPage(page).then(proxy => {
        const { width, height } = proxy.getViewport({ scale: 1 })
        if (width > 0 && height > 0) ratios.set(page, height / width)
      }, () => {}))
    }
    return pending.get(page)
  }))
}

const idle = () => new Promise(resolve => {
  if (window.requestIdleCallback) window.requestIdleCallback(resolve, { timeout: 500 })
  else window.setTimeout(resolve, 16)
})

// Posisi baca relatif terhadap slot pertama yang terlihat, supaya bisa
// dipulihkan setelah tinggi slot berubah (lebar baru atau rasio terukur).
// Binary search: posisi slot naik monoton, jadi cukup O(log n) pembacaan layout.
function captureAnchor(main, slots) {
  const total = Object.keys(slots).length
  if (!main || !total) return null
  const top = main.getBoundingClientRect().top
  let lo = 1
  let hi = total
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const rect = slots[mid]?.getBoundingClientRect()
    if (!rect) return null
    if (rect.bottom > top) hi = mid
    else lo = mid + 1
  }
  const rect = slots[lo]?.getBoundingClientRect()
  return rect ? { page: lo, offset: (top - rect.top) / rect.height } : null
}

function restoreAnchor(main, slots, anchor) {
  const element = slots[anchor.page]
  if (!element) return
  const rect = element.getBoundingClientRect()
  main.scrollTop += rect.top - main.getBoundingClientRect().top + anchor.offset * rect.height
}

export default function Reader() {
  const { contentId } = useParams()
  const { token } = useAuth()
  return <ReaderSession key={`${contentId}:${token || ''}`} cid={Number(contentId)} token={token} />
}

// Tiap buku/sesi memiliki observer, state, dan request sendiri.
function ReaderSession({ cid, token }) {
  const navigate = useNavigate()
  const [content, setContent] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  // Rasio tinggi/lebar tiap halaman. Yang belum terukur memakai estimasi dari
  // halaman tersimpan; diganti nilai asli saat pengukuran latar belakang tiba.
  const [pageRatios, setPageRatios] = useState([])
  const numPages = pageRatios.length
  const [resident, setResident] = useState({ active: 0, total: 0, reach: PROTECT, tick: 0, pages: new Map() })
  const [renderWidth, setRenderWidth] = useState(0)
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
  const [pageWidth, setPageWidth] = useState(0)
  const readerRef = useRef(null)
  const pageRefs = useRef({})
  const restoredPage = useRef(1)
  const restoredScroll = useRef(false)
  const noteRequest = useRef(0)
  const widthRef = useRef(0)
  const scrollAnchor = useRef(null)
  const sidebarOpenRef = useRef(sidebarOpen)
  useLayoutEffect(() => { sidebarOpenRef.current = sidebarOpen }, [sidebarOpen])
  // Cache rasio per halaman (lihat measureRatios).
  const ratioCache = useRef({ pending: new Map(), ratios: new Map() })
  const pdfRef = useRef(null)
  const ready = numPages > 0 && pageWidth > 0

  // Set halaman ter-mount diperbarui hanya saat halaman aktif (atau jumlah
  // halaman) berubah — pola "adjust state during render", tanpa efek tambahan.
  // Buka buku atau lompat jauh (drag scrollbar) mengulang jangkauan dari
  // PROTECT: halaman tujuan dirender dulu, halaman di depannya menyusul.
  if (numPages && (resident.active !== pageNumber || resident.total !== numPages)) {
    const jumped = !resident.active || resident.total !== numPages || Math.abs(pageNumber - resident.active) > AHEAD
    const reach = jumped ? PROTECT : resident.reach
    const tick = resident.tick + 1
    setResident({ active: pageNumber, total: numPages, reach, tick, pages: nextResident(resident.pages, pageNumber, numPages, tick, reach) })
  }

  // Perluas jangkauan ke depan: langsung ke IMMEDIATE_AHEAD pada frame
  // berikutnya (setelah halaman tujuan di-commit), lalu AHEAD_BATCH per browser
  // idle sampai AHEAD. Sengaja tidak bergantung pada halaman aktif: scroll
  // terus-menerus tidak boleh terus membatalkan pertumbuhan jangkauan.
  useEffect(() => {
    if (!ready || resident.reach >= AHEAD) return
    let cancelled = false
    const immediate = resident.reach < IMMEDIATE_AHEAD
    const wait = immediate ? new Promise(resolve => window.requestAnimationFrame(resolve)) : idle()
    wait.then(() => {
      if (cancelled) return
      setResident(current => {
        const reach = current.reach < IMMEDIATE_AHEAD ? IMMEDIATE_AHEAD : Math.min(AHEAD, current.reach + AHEAD_BATCH)
        const tick = current.tick + 1
        return { ...current, reach, tick, pages: nextResident(current.pages, current.active, current.total, tick, reach) }
      })
    })
    return () => { cancelled = true }
  }, [ready, resident.reach])

  useEffect(() => () => { pdfRef.current = null }, [])

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
    const request = ++noteRequest.current
    setNotesSaving(false)
    setNotes([])
    setNoteText('')
    setNotesError('')
    if (!token || !Number.isInteger(cid) || cid < 1) {
      setNotes([])
      setNotesLoading(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setNotesLoading(true)
    // Scroll cepat melewati banyak halaman: tunggu halaman diam dulu, jangan
    // kirim lalu batalkan satu request untuk tiap halaman yang hanya lewat.
    const timer = window.setTimeout(() => {
      apiFetch(`/api/activity/notes/${cid}?page_number=${pageNumber}`, { token, signal: controller.signal })
        .then(json => {
          if (cancelled) return
          const note = json.data?.[0]
          setNotes(note ? [note] : [])
          setNoteText(note?.note_text || '')
        })
        .catch(err => { if (!cancelled) setNotesError(err.message || 'Gagal memuat catatan') })
        .finally(() => { if (!cancelled) setNotesLoading(false) })
    }, NOTES_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
      if (noteRequest.current === request) noteRequest.current++
    }
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

  // Callback ref: wrapper dokumen baru ada setelah <Document> selesai memuat PDF.
  const documentRef = useCallback(element => {
    if (!element) return
    let timer = 0
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(0, Math.floor(entry.contentRect.width - 32))
      const apply = () => {
        if (widthRef.current === width) return
        // Lebar baru mengubah tinggi semua slot; simpan posisi baca untuk
        // dipulihkan di layout effect sebelum paint.
        if (widthRef.current) scrollAnchor.current = captureAnchor(readerRef.current, pageRefs.current)
        widthRef.current = width
        const widest = Math.min(MAX_PAGE_WIDTH, width + (sidebarOpenRef.current ? SIDEBAR_WIDTH : 0))
        setRenderWidth(prev => nextRenderWidth(prev, width, widest))
        setPageWidth(width)
      }
      window.clearTimeout(timer)
      // Lebar pertama langsung dipakai. Perubahan berikutnya (animasi sidebar,
      // resize window) ditunggu reda supaya tinggi slot tidak berubah per frame.
      if (!widthRef.current) apply()
      else timer = window.setTimeout(apply, RESIZE_SETTLE_MS)
    })
    observer.observe(element)
    return () => { window.clearTimeout(timer); observer.disconnect() }
  }, [])

  useLayoutEffect(() => {
    const anchor = scrollAnchor.current
    scrollAnchor.current = null
    if (anchor) restoreAnchor(readerRef.current, pageRefs.current, anchor)
  }, [pageWidth, pageRatios])

  // Salin rasio dari cache ke state. Hanya commit bila ada yang berubah, dan
  // simpan anchor dulu karena tinggi slot di atas viewport bisa bergeser.
  const ratiosRef = useRef(pageRatios)
  useLayoutEffect(() => { ratiosRef.current = pageRatios }, [pageRatios])
  const flushRatios = useCallback(() => {
    const prev = ratiosRef.current
    const { ratios } = ratioCache.current
    let changed = false
    const next = prev.map((ratio, index) => {
      const measured = ratios.get(index + 1)
      if (!measured || measured === ratio) return ratio
      changed = true
      return measured
    })
    if (!changed) return
    scrollAnchor.current = captureAnchor(readerRef.current, pageRefs.current)
    setPageRatios(next)
  }, [])

  // Halaman yang masuk set ter-mount diukur lebih dulu dari antrean latar
  // belakang, supaya slot yang tampil tidak pernah memakai estimasi.
  useEffect(() => {
    const pdf = pdfRef.current
    if (!pdf) return
    const pages = [...resident.pages.keys()].filter(page => !ratioCache.current.ratios.has(page))
    if (!pages.length) return
    measureRatios(pdf, pages, ratioCache.current).then(() => { if (pdfRef.current === pdf) flushRatios() })
  }, [resident.pages, flushRatios])

  // Scroll ke halaman tersimpan sekali, begitu slot pertama kali punya tinggi final.
  useLayoutEffect(() => {
    if (!ready || restoredScroll.current) return
    restoredScroll.current = true
    pageRefs.current[Math.min(restoredPage.current, numPages)]?.scrollIntoView({ block: 'start' })
  }, [ready, numPages])

  useEffect(() => {
    if (!ready || !readerRef.current) return
    // Halaman aktif = slot yang memotong garis tengah viewport. Ambang
    // intersectionRatio 0.5 tidak pernah tercapai bila halaman lebih dari dua
    // kali tinggi viewport (layar pendek), sehingga halaman aktif macet.
    // ponytail: halaman terakhir yang lebih pendek dari setengah viewport tidak
    // pernah menyentuh garis tengah; tambahkan cek "scroll di dasar" bila perlu.
    const observer = new IntersectionObserver(entries => {
      const visible = entries.find(entry => entry.isIntersecting)
      if (visible) setPageNumber(Number(visible.target.dataset.page))
    }, { root: readerRef.current, rootMargin: '-50% 0px -50% 0px', threshold: 0 })

    Object.values(pageRefs.current).forEach(element => observer.observe(element))
    return () => observer.disconnect()
  }, [ready])

  async function onDocumentLoadSuccess(pdf) {
    // StrictMode memanggil efek onLoadSuccess react-pdf dua kali untuk pdf yang sama.
    if (pdfRef.current === pdf) return
    pdfRef.current = pdf
    const total = pdf.numPages
    const cache = ratioCache.current
    const start = Math.min(restoredPage.current, total)
    // Hanya halaman di sekitar halaman tersimpan yang ditunggu sebelum Reader
    // tampil; sisanya memakai estimasi rasio halaman tersimpan.
    const first = []
    for (let page = Math.max(1, start - PROTECT); page <= Math.min(total, start + PROTECT); page++) first.push(page)
    await measureRatios(pdf, first, cache)
    if (pdfRef.current !== pdf) return
    const { ratios } = cache
    const estimate = ratios.get(start) || ratios.values().next().value || Math.SQRT2
    setPageRatios(Array.from({ length: total }, (_, index) => ratios.get(index + 1) || estimate))
  }

  // Sisanya diukur bertahap saat browser idle, baru SETELAH slot pertama
  // tampil, supaya tidak bersaing dengan render awal. Rasio yang sama dengan
  // estimasi tidak memicu render ulang.
  useEffect(() => {
    const pdf = pdfRef.current
    if (!ready || !pdf) return
    let cancelled = false
    ;(async () => {
      for (let from = 1; from <= numPages; from += MEASURE_BATCH) {
        await idle()
        if (cancelled) return
        const batch = []
        for (let page = from; page < Math.min(numPages + 1, from + MEASURE_BATCH); page++) batch.push(page)
        await measureRatios(pdf, batch, ratioCache.current)
        if (cancelled) return
        flushRatios()
      }
    })()
    return () => { cancelled = true }
  }, [ready, numPages, flushRatios])

  async function submitNote(event) {
    event.preventDefault()
    const text = noteText.trim()
    if (!text || !token || notesLoading || notesSaving) return
    const request = noteRequest.current
    setNotesSaving(true)
    setNotesError('')
    try {
      const json = await apiFetch('/api/activity/notes', {
        method: 'POST',
        token,
        body: JSON.stringify({ content_id: cid, page_number: pageNumber, note_text: text }),
      })
      if (request !== noteRequest.current) return
      setNotes([json.data])
      setNoteText(json.data.note_text)
    } catch (err) {
      if (request === noteRequest.current) setNotesError(err.message || 'Gagal menyimpan catatan')
    } finally {
      if (request === noteRequest.current) setNotesSaving(false)
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
        {/* scrollbar-gutter stable: lebar tidak menyusut saat scrollbar muncul setelah slot dirender.
            overflow-x-hidden: selama animasi sidebar, slot masih memakai lebar lama sampai resize reda. */}
        <main ref={readerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 [scrollbar-gutter:stable] md:px-8">
          {loading && <div className="flex justify-center pt-20"><Loader2 className="animate-spin text-amber-600" /></div>}
          {error && <div className="mx-auto max-w-2xl rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
          {!loading && !error && content && (
            <Document file={content.file_url} onLoadSuccess={onDocumentLoadSuccess} loading={<div className="flex justify-center py-20"><Loader2 className="animate-spin text-amber-600" /></div>} error={<p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">PDF gagal dimuat. Pastikan file dapat diakses dari browser.</p>}>
              <div ref={documentRef} className="mx-auto flex w-full max-w-5xl flex-col gap-2">
                {!ready && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-amber-600" /></div>}
                {ready && pageRatios.map((ratio, index) => (
                  <PdfPage
                    key={index + 1}
                    page={index + 1}
                    render={resident.pages.has(index + 1)}
                    pageWidth={pageWidth}
                    renderWidth={renderWidth}
                    ratio={ratio}
                    setPageRef={setPageRef}
                  />
                ))}
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
              <textarea value={noteText} disabled={notesLoading || notesSaving || !token} onChange={event => setNoteText(event.target.value)} placeholder="Tulis catatanmu..." rows={3} className="w-full resize-none rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 placeholder-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <button type="submit" disabled={!noteText.trim() || notesLoading || notesSaving || !token} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:bg-amber-200">{notesSaving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Simpan Catatan</button>
              {!token && <p className="mt-1 text-center text-[10px] text-amber-400">Login untuk menyimpan catatan</p>}
            </form>
          </div>
        </aside>
      </div>
    </div>
  )
}
