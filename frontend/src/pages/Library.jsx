import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, BookOpen, RefreshCw, Telescope } from 'lucide-react'
import { apiFetch } from '../lib/api'
import CategoryPills from '../components/library/CategoryPills'
import BookShelf from '../components/library/BookShelf'

const SHELF_LIMIT = 24
const NEWEST_LIMIT = 100

function createdTime(value) {
  const parsed = Date.parse(String(value || '').replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : 0
}

async function buildPreviewState() {
  const { buildHeroCards } = await import('../lib/heroCovers')
  const cards = buildHeroCards([])
  const pick = (start, shelfId) => Array.from({ length: 8 }, (_, index) => {
    const card = cards[(start + index) % cards.length]
    return {
      id: `${shelfId}-${index}`,
      title: card.title,
      author: card.author,
      cover_url: card.src,
      preview: true,
    }
  })

  const fields = [
    { id: 'preview-management', name: 'Manajemen' },
    { id: 'preview-technology', name: 'Teknologi' },
    { id: 'preview-health', name: 'Kesehatan' },
    { id: 'preview-education', name: 'Pendidikan' },
    { id: 'preview-arts', name: 'Seni & Kreativitas' },
  ]

  return {
    loading: false,
    error: null,
    warnings: [],
    preview: true,
    fields,
    newest: pick(0, 'preview-latest'),
    newestTitle: 'Contoh koleksi',
    shelves: fields.map((field, index) => ({
      key: field.id,
      fieldId: field.id,
      title: field.name,
      books: pick(index * 6 + 2, field.id),
    })),
  }
}

async function fetchLibrary(signal) {
  const [fieldsResult, newestResult] = await Promise.allSettled([
    apiFetch('/api/fields', { signal }),
    apiFetch(`/api/contents?limit=${NEWEST_LIMIT}&page=1`, { signal }),
  ])
  if (signal.aborted) return null

  const warnings = []
  const fieldsFailed = fieldsResult.status === 'rejected'
  const newestFailed = newestResult.status === 'rejected'

  const fields = fieldsFailed
    ? []
    : (Array.isArray(fieldsResult.value?.data) ? fieldsResult.value.data : [])
      .filter(field => field?.id != null && field.is_active !== false && field.is_active !== 0)
      .map(field => ({ id: field.id, name: field.name || 'Tanpa nama' }))

  let newest = []
  let newestTitle = 'Baru ditambahkan'
  if (!newestFailed) {
    const rows = Array.isArray(newestResult.value?.data) ? newestResult.value.data : []
    const total = Number(newestResult.value?.meta?.total)
    const complete = Number.isFinite(total) ? total <= rows.length : rows.length < NEWEST_LIMIT
    newestTitle = complete ? 'Baru ditambahkan' : 'Dari koleksi'
    newest = rows
      .slice()
      .sort((a, b) => createdTime(b.created_at) - createdTime(a.created_at) || Number(b.id) - Number(a.id))
      .slice(0, 20)
  }

  const categoryResults = fields.length
    ? await Promise.allSettled(fields.map(field =>
      apiFetch(`/api/contents?limit=${SHELF_LIMIT}&field_id=${encodeURIComponent(field.id)}`, { signal })
    ))
    : []
  if (signal.aborted) return null

  const failedCategories = []
  const shelves = []
  categoryResults.forEach((result, index) => {
    const field = fields[index]
    if (result.status === 'rejected') {
      failedCategories.push(field.name)
      return
    }
    const rows = Array.isArray(result.value?.data) ? result.value.data.slice(0, SHELF_LIMIT) : []
    if (rows.length) {
      shelves.push({
        key: String(field.id),
        fieldId: field.id,
        title: field.name,
        books: rows,
      })
    }
  })

  if (fieldsFailed) warnings.push('Daftar kategori tidak dapat dimuat.')
  if (newestFailed) warnings.push('Koleksi terbaru tidak dapat dimuat.')
  if (failedCategories.length) {
    warnings.push(`${failedCategories.length} kategori gagal dimuat: ${failedCategories.join(', ')}.`)
  }

  const fatal = fieldsFailed && newestFailed

  return {
    loading: false,
    fields,
    newest,
    newestTitle,
    shelves,
    warnings,
    preview: false,
    error: fatal
      ? (newestResult.reason?.message || fieldsResult.reason?.message || 'Gagal memuat koleksi.')
      : null,
  }
}

function ShelfSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-3 h-7 w-48 animate-pulse rounded bg-sand/60" />
      <div className="flex overflow-hidden -ml-3 sm:-ml-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="shrink-0 basis-[43%] pl-3 sm:basis-[29%] sm:pl-4 md:basis-[22.5%] lg:basis-[18%] xl:basis-[13.3%]">
            <div className="aspect-[2/3] animate-pulse rounded-xl border border-sand/60 bg-cream" />
            <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-sand/50" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Notice({ children, tone = 'warning' }) {
  const warning = tone === 'warning'
  return (
    <div
      role={warning ? 'status' : 'alert'}
      className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${
        warning
          ? 'border-clay/25 bg-cream/60 text-ink'
          : 'border-clay/35 bg-cream/80 text-charcoal'
      }`}
    >
      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${warning ? 'text-clay-deep' : 'text-clay'}`} aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}

export default function Library() {
  const [params] = useSearchParams()
  const preview = Boolean(import.meta.env.DEV) && params.get('preview') === '1'
  const [state, setState] = useState({
    loading: true,
    fields: [],
    newest: [],
    newestTitle: 'Baru ditambahkan',
    shelves: [],
    warnings: [],
    preview: false,
    error: null,
  })
  const [active, setActive] = useState('all')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState(previous => ({ ...previous, loading: true, error: null, warnings: [] }))

    if (preview) {
      buildPreviewState()
        .then(next => { if (!cancelled) setState(next) })
        .catch(error => {
          if (cancelled) return
          setState(previous => ({
            ...previous,
            loading: false,
            error: error.message || 'Gagal memuat pratinjau.',
          }))
        })
      return () => { cancelled = true }
    }

    const controller = new AbortController()
    fetchLibrary(controller.signal)
      .then(next => { if (!cancelled && next) setState(next) })
      .catch(error => {
        if (cancelled || error.name === 'AbortError') return
        setState(previous => ({
          ...previous,
          loading: false,
          error: error.message || 'Gagal memuat koleksi.',
        }))
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [preview, reloadKey])

  useEffect(() => {
    if (active === 'all') return
    if (!state.fields.some(field => String(field.id) === active)) setActive('all')
  }, [active, state.fields])

  const visibleShelves = active === 'all'
    ? state.shelves
    : state.shelves.filter(shelf => shelf.key === active)

  const hasBooks = state.newest.length > 0 || state.shelves.length > 0
  const selectedField = state.fields.find(field => String(field.id) === active)

  return (
    <main className="min-h-screen bg-ivory pb-16" aria-busy={state.loading}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="pt-6 sm:pt-8">
          <h1 className="font-serif text-[1.75rem] leading-tight tracking-tight text-charcoal sm:text-4xl">
            Jelajahi dunia pengetahuan.
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            Temukan bacaan yang sesuai dengan minatmu.
          </p>
        </header>

        <div className="mt-5">
          <CategoryPills categories={state.fields} active={active} onChange={setActive} />
        </div>

        {state.preview && (
          <div className="mt-5 rounded-xl border border-clay/30 bg-cream/70 px-4 py-2.5 text-xs text-ink" role="status">
            Mode pratinjau pengembangan. Sampul dan judul di bawah adalah data contoh lokal, bukan koleksi produksi.
          </div>
        )}

        {state.error && (
          <div className="mt-6">
            <Notice tone="error">
              <p className="font-semibold">Koleksi tidak dapat dimuat.</p>
              <p className="mt-1 text-xs text-muted">{state.error}</p>
              <button
                type="button"
                onClick={() => setReloadKey(value => value + 1)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-clay/35 bg-ivory px-3 py-1.5 text-xs font-semibold text-clay-deep transition-colors hover:border-clay focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Coba lagi
              </button>
            </Notice>
          </div>
        )}

        {!state.error && state.warnings.length > 0 && (
          <div className="mt-5 space-y-2">
            {state.warnings.map(warning => <Notice key={warning}>{warning}</Notice>)}
          </div>
        )}

        {state.loading && (
          <div className="mt-7 space-y-8 sm:space-y-10">
            {Array.from({ length: 3 }).map((_, index) => <ShelfSkeleton key={index} />)}
          </div>
        )}

        {!state.loading && !state.error && !hasBooks && (
          <div className="mt-10 rounded-2xl border border-dashed border-sand bg-cream/40 px-6 py-12 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-clay/60" aria-hidden="true" />
            <p className="mt-3 font-serif text-xl text-charcoal">Belum ada koleksi.</p>
            <p className="mt-1 text-sm text-muted">Materi yang dipublikasikan akan muncul di sini.</p>
            <Link
              to="/karier"
              className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-charcoal/20 px-4 py-2 text-sm font-semibold text-charcoal transition-colors hover:border-clay hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
            >
              Jelajahi minat &amp; karier <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        )}

        {!state.loading && !state.error && hasBooks && (
          <div className="mt-7 space-y-8 sm:space-y-10">
            {active === 'all' && state.newest.length > 0 && (
              <BookShelf title={state.newestTitle} books={state.newest} priority />
            )}
            {visibleShelves.map(shelf => (
              <BookShelf
                key={shelf.key}
                title={shelf.title}
                books={shelf.books}
                href={state.preview ? undefined : `/field/${encodeURIComponent(shelf.fieldId)}`}
              />
            ))}
            {active !== 'all' && selectedField && visibleShelves.length === 0 && (
              <div className="rounded-2xl border border-dashed border-sand bg-cream/40 px-6 py-10 text-center">
                <p className="font-serif text-lg text-charcoal">Belum ada materi di kategori ini.</p>
                <p className="mt-1 text-sm text-muted">Coba kategori lain atau kembali ke semua koleksi.</p>
              </div>
            )}
          </div>
        )}

        {!state.loading && !state.error && hasBooks && (
          <aside className="mt-12 flex flex-col gap-4 rounded-2xl border border-sand bg-cream/40 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-start gap-3">
              <Telescope className="mt-0.5 h-5 w-5 shrink-0 text-clay-deep" aria-hidden="true" />
              <div>
                <p className="font-serif text-lg text-charcoal">Belum yakin mulai dari mana?</p>
                <p className="mt-0.5 text-sm text-muted">Temukan arah lewat pohon minat dan karier Edulib.</p>
              </div>
            </div>
            <Link
              to="/karier"
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-charcoal px-4 py-2 text-sm font-semibold text-ivory transition-colors hover:bg-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
            >
              Eksplorasi karier <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </aside>
        )}
      </div>
    </main>
  )
}
