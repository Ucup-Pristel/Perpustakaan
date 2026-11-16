import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  ArrowRight,
  BookMarked,
  BookOpen,
  Compass,
  FileText,
  GraduationCap,
  Layers,
  ListChecks,
  LogIn,
  Sparkles,
  StickyNote,
  TrendingUp,
} from 'lucide-react'
import LandingNavbar from '../components/ui/LandingNavbar'
import LandingFooter from '../components/ui/LandingFooter'
import HeroParallax from '../components/ui/HeroParallax'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { buildHeroCards, curatedForContent, isImageUrl } from '../lib/heroCovers'

const FEATURES = [
  {
    icon: BookOpen,
    title: 'Perpustakaan digital',
    body: 'Koleksi PDF dan e-book yang dapat dibaca langsung di browser, lengkap dengan ISBN dan penulis.',
  },
  {
    icon: ListChecks,
    title: 'Pohon minat & jurusan',
    body: 'Bidang dan sub-bidang disusun sebagai jalur karier, bukan kategori subjek yang kaku.',
  },
  {
    icon: Layers,
    title: 'Gradasi tingkat Level 1–4',
    body: 'Dari eksplorasi ringan hingga pra-kuliah, setiap jalur punya alur baca yang jelas.',
  },
  {
    icon: TrendingUp,
    title: 'Progres bacaan',
    body: 'Posisi halaman terakhir tersimpan otomatis sehingga bacaan bisa dilanjutkan kapan saja.',
  },
  {
    icon: StickyNote,
    title: 'Catatan per halaman',
    body: 'Simpan catatan pada halaman tertentu dan temukan kembali semuanya dari dashboard.',
  },
  {
    icon: FileText,
    title: 'Pencarian materi',
    body: 'Cari berdasarkan judul, penulis, dan kata sinonim yang relevan di seluruh koleksi.',
  },
]

const LEVELS = [
  { level: 1, name: 'Eksplorasi', body: 'Fiksi ilmiah, novel sejarah, dan sains populer untuk memicu rasa ingin tahu.' },
  { level: 2, name: 'Pengantar', body: 'Buku teks non-fiksi dan ensiklopedia yang membangun fondasi pemahaman.' },
  { level: 3, name: 'Pendalaman', body: 'Review paper dan buku akademis menengah untuk memperdalam bidang.' },
  { level: 4, name: 'Pra-Kuliah', body: 'Jurnal, paper konferensi, dan skripsi terbuka sebagai gambaran perkuliahan.' },
]

/**
 * Ambil data dengan dua tahap supaya fetch kedua ringan:
 * 1. `/api/fields` (paralel dengan`) — untuk showcase karier.
 * 2. `/api/contents?limit=...` per bidang dengan slug yang dikenal /library.
 * Semua kegagalan ditelan menjadi state kosong: landing tetap utuh tanpa backend.
 */
function useLandingData() {
  const [state, setState] = useState({ fields: [], contents: [], loading: true })

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function load() {
      try {
        const fieldsJson = await apiFetch('/api/fields', { signal: controller.signal })
        const fields = (fieldsJson?.data || []).filter(field => field.is_active !== false)
        const firstThree = fields.slice(0, 3)
        const results = await Promise.all(
          firstThree.map(field =>
            apiFetch(`/api/contents?limit=4&field_id=${encodeURIComponent(field.id)}`, {
              signal: controller.signal,
            }).catch(() => null)
          )
        )
        if (cancelled) return
        const contents = results.flatMap(json => json?.data || [])
        setState({ fields, contents, loading: false })
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return
        setState({ fields: [], contents: [], loading: false })
      }
    }

    load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  return state
}

/** Scroll ke hash setelah landing dirender (Link dari halaman lain / navbar footer). */
function useHashScroll() {
  const { hash } = useLocation()

  useEffect(() => {
    if (!hash) return
    const id = hash.slice(1)
    // requestAnimationFrame memberi kesempatan layout (section + gambar) selesai.
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [hash])
}

function SectionHeading({ eyebrow, title, body, align = 'left' }) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-clay-deep">{eyebrow}</p>
      <h2 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-charcoal sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-base leading-relaxed text-muted">{body}</p>}
    </div>
  )
}

function About() {
  return (
    <section id="tentang" className="scroll-mt-24 border-t border-sand/70 bg-ivory">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:px-8 lg:py-24">
        <SectionHeading
          eyebrow="Tentang Edulib"
          title="Jembatan dari bacaan ringan menuju literatur akademis."
          body="Edulib adalah perpustakaan digital yang dirancang sebagai kompas karier dan minat. Alih-alih menyusun koleksi berdasarkan kategori subjek yang kaku, Edulib menata bacaan mengikuti jalur minat dan jurusan."
        />
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-sand bg-cream/60 p-6">
            <BookMarked className="h-6 w-6 text-clay" aria-hidden="true" />
            <h3 className="mt-4 font-serif text-xl text-charcoal">Kurasi bertingkat</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Setiap jalur memiliki alur dari eksplorasi hingga pra-kuliah, sehingga pembaca tahu langkah berikutnya.
            </p>
          </div>
          <div className="rounded-2xl border border-sand bg-cream/60 p-6">
            <Compass className="h-6 w-6 text-clay" aria-hidden="true" />
            <h3 className="mt-4 font-serif text-xl text-charcoal">Berbasis minat</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Materi dihubungkan dengan bidang dan sub-bidang yang relevan dengan arah studi dan karier.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function Features() {
  return (
    <section id="fitur" className="scroll-mt-24 bg-cream/50">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <SectionHeading
          eyebrow="Fitur platform"
          title="Semua yang dibutuhkan untuk belajar dengan arah."
          body="Fitur Edulib mengikuti alur baca nyata: menemukan bidang, membaca, mencatat, lalu melanjutkan."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-2xl border border-sand bg-ivory p-6 transition hover:border-clay/40 hover:shadow-sm">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-cream text-clay-deep">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-serif text-lg text-charcoal">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function LibraryShowcase({ contents, loading }) {
  const shelves = contents.slice(0, 6)

  return (
    <section id="koleksi" className="scroll-mt-24 bg-ivory">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            eyebrow="Perpustakaan digital"
            title="Baca langsung di browser."
            body="Koleksi PDF dan e-book yang dikurasi per bidang. Buka dari perangkat mana pun dan lanjutkan tepat di halaman terakhir."
          />
          <Link
            to="/library"
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-charcoal/20 px-5 py-2.5 text-sm font-semibold text-charcoal transition hover:border-clay hover:text-clay-deep"
          >
            Lihat semua koleksi <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {loading && Array.from({ length: 6 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="aspect-[3/4] animate-pulse rounded-xl border border-sand bg-cream/60" />
          ))}
          {!loading && shelves.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-sand bg-cream/40 p-8 text-center">
              <p className="font-serif text-lg text-charcoal">Koleksi sedang disiapkan.</p>
              <p className="mt-1 text-sm text-muted">Buka perpustakaan untuk melihat daftar bidang dan materi yang tersedia.</p>
            </div>
          )}
          {!loading && shelves.map((content, index) => {
            const curated = curatedForContent(content, index)
            const src = isImageUrl(content.cover_url) ? content.cover_url : curated?.src
            return (
            <Link
              key={content.id}
              to="/library"
              className="group block overflow-hidden rounded-xl border border-sand bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="aspect-[2/3] bg-cream">
                {src ? (
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-serif text-sm text-muted">
                    Edulib
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="line-clamp-2 text-xs font-semibold leading-snug text-charcoal">{content.title}</p>
                {content.author && <p className="mt-1 line-clamp-1 text-[11px] text-muted">{content.author}</p>}
              </div>
            </Link>
            )
          })}
        </div>

        <div className="mt-12 rounded-2xl border border-sand bg-cream/40 p-6 sm:p-8">
          <h3 className="font-serif text-xl text-charcoal">Gradasi tingkat kesulitan</h3>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LEVELS.map(({ level, name, body }) => (
              <li key={level} className="rounded-xl border border-sand bg-ivory p-4">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-clay-deep">Level {level}</span>
                <p className="mt-1 font-serif text-lg text-charcoal">{name}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

function CareerShowcase({ fields, loading }) {
  return (
    <section id="karier" className="scroll-mt-24 bg-charcoal text-ivory">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-clay">Eksplorasi karier</p>
            <h2 className="mt-3 max-w-lg font-serif text-3xl leading-tight tracking-tight sm:text-4xl">
              Jelajahi bidang sebelum memilih jurusan.
            </h2>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-ivory/65">
              Bidang dan sub-bidang di Edulib disusun mengikuti pohon minat dan jurusan. Setiap bidang
              menghubungkan minat dengan materi pembelajaran yang relevan.
            </p>
            <Link
              to="/library"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-ivory px-5 py-2.5 text-sm font-semibold text-charcoal transition hover:bg-cream"
            >
              Mulai eksplorasi <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {loading && Array.from({ length: 4 }).map((_, i) => (
              <div key={`f-skeleton-${i}`} className="h-28 animate-pulse rounded-xl bg-ivory/10" />
            ))}
            {!loading && fields.length === 0 && (
              <p className="rounded-xl border border-ivory/15 p-6 text-sm text-ivory/60 sm:col-span-2">
                Daftar bidang belum dapat dimuat. Perpustakaan tetap dapat dibuka dari menu.
              </p>
            )}
            {!loading && fields.slice(0, 4).map(field => (
              <Link
                key={field.id}
                to={`/field/${field.id}`}
                className="group rounded-xl border border-ivory/15 bg-ivory/[0.03] p-5 transition hover:border-clay/60 hover:bg-ivory/[0.06]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xl" aria-hidden="true">{field.icon || '📚'}</span>
                  <ArrowRight className="h-4 w-4 text-ivory/40 transition group-hover:text-clay" aria-hidden="true" />
                </div>
                <h3 className="mt-3 font-serif text-lg">{field.name}</h3>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ivory/55">{field.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function Mission() {
  return (
    <section id="misi" className="scroll-mt-24 bg-ivory">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <SectionHeading eyebrow="Misi kami" title="Membantu pelajar menemukan arah, bukan sekadar bahan bacaan." />
          <div className="space-y-6">
            {[
              'Membantu siswa menemukan jalur karier dan jurusan kuliah melalui eksplorasi bacaan bertingkat.',
              'Menyediakan konten yang dikurasi dengan gradasi kesulitan dari eksplorasi hingga pra-kuliah.',
              'Menggantikan kategori subjek yang kaku dengan kategori berbasis pohon minat dan jurusan.',
              'Memberi gambaran nyata tentang apa yang dipelajari di bangku kuliah sebelum memilih jurusan.',
            ].map((item, index) => (
              <div key={item} className="flex gap-4 border-b border-sand pb-5 last:border-0">
                <span className="font-serif text-2xl text-clay/70">{String(index + 1).padStart(2, '0')}</span>
                <p className="text-base leading-relaxed text-ink/80">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function CallToAction() {
  const { user } = useAuth()
  const isAuthenticated = Boolean(user)

  return (
    <section className="bg-cream/60">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="relative overflow-hidden rounded-3xl border border-sand bg-charcoal px-6 py-12 text-center sm:px-12 sm:py-16">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(198,93,40,0.22),transparent_70%)]" />
          <div className="relative">
            <p className="inline-flex items-center gap-2 rounded-full border border-ivory/15 px-3 py-1 text-xs font-medium text-ivory/70">
              <Sparkles className="h-3.5 w-3.5 text-clay" aria-hidden="true" /> Gratis untuk mulai menjelajah
            </p>
            <h2 className="mx-auto mt-5 max-w-2xl font-serif text-3xl leading-tight tracking-tight text-ivory sm:text-4xl">
              Mulai dari satu bacaan, temukan arah berikutnya.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ivory/60 sm:text-base">
              Buka perpustakaan untuk melihat bidang yang tersedia, atau masuk untuk melanjutkan progres dan catatan Anda.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                to="/library"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-ivory px-6 py-3 text-sm font-semibold text-charcoal transition hover:bg-cream"
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" /> Jelajahi Perpustakaan
              </Link>
              {isAuthenticated ? (
                <Link
                  to="/dashboard"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-ivory/25 px-6 py-3 text-sm font-semibold text-ivory transition hover:border-ivory/60"
                >
                  <GraduationCap className="h-4 w-4" aria-hidden="true" /> Buka Dashboard
                </Link>
              ) : (
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-ivory/25 px-6 py-3 text-sm font-semibold text-ivory transition hover:border-ivory/60"
                >
                  <LogIn className="h-4 w-4" aria-hidden="true" /> Masuk
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function Landing() {
  useHashScroll()
  const { fields, contents, loading } = useLandingData()

  // Data API diutamakan; sampul kurasi lokal mengisi sisanya sehingga hero
  // tetap 3 baris penuh walau backend offline. Lihat src/lib/heroCovers.js.
  const cards = useMemo(() => buildHeroCards(contents), [contents])

  return (
    <div className="min-h-screen bg-ivory">
      <LandingNavbar />
      <main>
        <HeroParallax cards={cards} />
        <About />
        <Features />
        <LibraryShowcase contents={contents} loading={loading} />
        <CareerShowcase fields={fields} loading={loading} />
        <Mission />
        <CallToAction />
      </main>
      <LandingFooter />
    </div>
  )
}
