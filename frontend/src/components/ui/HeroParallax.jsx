import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useScroll, useTransform, useSpring } from 'framer-motion'
import { ArrowDown, ArrowRight, LibraryBig } from 'lucide-react'
import { useReducedMotion } from '../../lib/reducedMotion'
import { useIsDesktop } from '../../lib/useIsDesktop'
import { splitRows } from '../../lib/heroCovers'

// Nilai spring persis seperti referensi Hero Parallax.
const SPRING = { stiffness: 300, damping: 30, bounce: 100 }

/**
 * Satu sampul buku. Aspect rasio 2:3 (portrait).
 *
 * onError: `cover_url` dari API bisa menunjuk objek R2 yang sudah dihapus.
 * Kalau itu terjadi, kartu jatuh ke sampul kurasi, bukan kotak kosong.
 */
// Komposisi hero mensyaratkan sampul portrait ±2:3 (lihat brief revisi).
// Sampul dari API sering berupa halaman pertama PDF, jadi rasionya diperiksa
// setelah gambar termuat; yang tidak cocok jatuh ke sampul kurasi. Sampul buku
// asli yang memang portrait tetap dipakai — integrasi produksi tidak dimatikan.
const PORTRAIT_MIN = 0.55
const PORTRAIT_MAX = 0.8

function BookCard({ card, translate, priority, size }) {
  const [src, setSrc] = useState(card.src)

  return (
    <motion.div
      style={translate ? { x: translate } : undefined}
      whileHover={{ y: -20 }}
      className={`group/book relative shrink-0 ${size}`}
    >
      <Link
        to={card.link}
        aria-label={`${card.title} — buka perpustakaan`}
        className="block h-full w-full overflow-hidden rounded-lg shadow-[0_18px_40px_-18px_rgba(34,31,27,0.55)] ring-1 ring-charcoal/10 transition-shadow duration-300 group-hover/book:shadow-[0_28px_60px_-20px_rgba(34,31,27,0.6)] focus:outline-none focus-visible:ring-2 focus-visible:ring-clay"
      >
        <img
          src={src}
          alt={`Sampul ${card.title}`}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={event => {
            const { naturalWidth: w, naturalHeight: h } = event.currentTarget
            if (!card.fallbackSrc || !w || !h || src === card.fallbackSrc) return
            const ratio = w / h
            if (ratio < PORTRAIT_MIN || ratio > PORTRAIT_MAX) setSrc(card.fallbackSrc)
          }}
          onError={() => {
            if (card.fallbackSrc && src !== card.fallbackSrc) setSrc(card.fallbackSrc)
          }}
          className="h-full w-full select-none object-cover"
        />
      </Link>
    </motion.div>
  )
}

/** Ukuran kartu: 2:3 portrait, diskalakan per breakpoint komposisi. */
// 2:3 portrait. Di desktop 288×432; 8 kartu + gap = 2750px, hampir sama dengan
// bidang referensi (5 × 480px + gap = 2800px), supaya saat dimiringkan
// komposisi tetap menutup seluruh viewport, bukan grid sempit di tengah.
const CARD_SIZE = {
  full: 'h-[27rem] w-[18rem]',
  compact: 'h-[13.5rem] w-[9rem]',
}

/**
 * Baris kartu bergerak. `reverse` meniru `flex-row-reverse` referensi.
 *
 * Wrapper `justify-center` + lebar w-max: baris diukur lebar layar, jadi saat
 * scroll = 0 komposisi berada di tengah (bukan terpotong di kiri) dan translate
 * positif membawanya ke kanan tanpa celah kosong.
 */
function Row({ cards, translate, reverse = false, priorityCount = 0 }) {
  return (
    <div className="flex justify-center">
      <div className={`flex w-max items-start gap-16 ${reverse ? 'flex-row-reverse' : 'flex-row'}`}>
        {cards.map((card, index) => (
          <BookCard
            key={card.key}
            card={card}
            translate={translate}
            priority={index < priorityCount}
            size={CARD_SIZE.full}
          />
        ))}
      </div>
    </div>
  )
}

/** Header landing; sengaja berada di luar wrapper 3D agar tidak ikut berotasi. */
function HeroHeader() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 sm:pt-16 lg:px-8">
      <p className="inline-flex items-center gap-2 rounded-full border border-sand bg-cream/70 px-3 py-1 text-xs font-medium text-clay-deep">
        <LibraryBig className="h-3.5 w-3.5" aria-hidden="true" />
        Perpustakaan digital &amp; eksplorasi karier
      </p>
      <h1
        id="hero-title"
        className="mt-6 max-w-3xl font-serif text-[2.5rem] leading-[1.06] tracking-tight text-charcoal sm:text-5xl lg:text-6xl"
      >
        Temukan Ilmu. Jelajahi Potensi.{' '}
        <span className="text-clay-deep">Bangun Masa Depan.</span>
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
        Edulib menghubungkan akses literasi digital dengan eksplorasi minat dan karier dalam satu platform pembelajaran.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          to="/library"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-charcoal px-6 py-3 text-sm font-semibold text-ivory transition hover:bg-clay-deep"
        >
          Jelajahi Perpustakaan <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          to="/register"
          className="inline-flex items-center justify-center gap-2 rounded-full border border-charcoal/20 px-6 py-3 text-sm font-semibold text-charcoal transition hover:border-clay hover:text-clay-deep"
        >
          Buat Akun
        </Link>
      </div>
      <p className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted">
        <ArrowDown className="h-3.5 w-3.5 animate-bounce motion-reduce:animate-none" aria-hidden="true" />
        Gulir untuk menjelajah koleksi
      </p>
    </div>
  )
}

/**
 * Fallback (mobile / prefers-reduced-motion): tiga strip sampul yang bisa
 * digeser horizontal. Tetap tiga baris dan full-bleed, tapi tanpa transform 3D.
 */
function StillRows({ rows }) {
  return (
    <div className="mt-8 space-y-5 pb-12">
      {rows.map((cards, row) => (
        <div
          key={`still-${row}`}
          className="flex snap-x gap-4 overflow-x-auto px-4 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {cards.map(card => (
            <div key={card.key} className="snap-start">
              <BookCard card={card} size={CARD_SIZE.compact} priority={row === 0} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function HeroParallax({ cards = [] }) {
  const ref = useRef(null)
  const reduced = useReducedMotion()
  const isDesktop = useIsDesktop()
  const animated = isDesktop && !reduced && cards.length > 0

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start'],
  })

  // Referensi: geser kanan 0 → +1000, baris kedua 0 → -1000.
  const translateX = useSpring(useTransform(scrollYProgress, [0, 1], [0, 900]), SPRING)
  const translateXReverse = useSpring(useTransform(scrollYProgress, [0, 1], [0, -900]), SPRING)

  // Referensi: rotateX 15→0, rotateZ 20→0, opacity 0.2→1, translateY -700→500,
  // semuanya pada 20% progress pertama. Rentang di sini disesuaikan dengan tinggi
  // komposisi Edulib supaya "pelurusan" terasa selama ~1 layar scroll.
  const rotateX = useSpring(useTransform(scrollYProgress, [0, 0.35], [15, 0]), SPRING)
  const rotateZ = useSpring(useTransform(scrollYProgress, [0, 0.35], [20, 0]), SPRING)
  const opacity = useSpring(useTransform(scrollYProgress, [0, 0.35], [0.35, 1]), SPRING)
    // Nilai awal negatif menaikkan komposisi ke dalam hero, tetapi tidak boleh
  // sampai menutup header. Referensi memakai -700..500; di sini rentangnya
  // dikecilkan karena tinggi hero Edulib jauh lebih pendek dari 300vh.
  const translateY = useSpring(useTransform(scrollYProgress, [0, 0.35], [-40, 90]), SPRING)

  const rows = splitRows(cards)

  return (
    <section
      ref={ref}
      aria-labelledby="hero-title"
      className="relative overflow-hidden bg-ivory [perspective:1000px] [transform-style:preserve-3d]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,rgba(198,93,40,0.14),transparent_65%)]"
      />

      <div className="relative z-10">
        <HeroHeader />
      </div>

      {animated ? (
        <motion.div
          style={{ rotateX, rotateZ, translateY, opacity }}
          className="relative mt-40 pb-24 will-change-transform sm:mt-44"
        >
          <div className="mb-10">
            <Row cards={rows[0]} translate={translateX} reverse priorityCount={4} />
          </div>
          <div className="mb-10">
            <Row cards={rows[1]} translate={translateXReverse} priorityCount={2} />
          </div>
          <Row cards={rows[2]} translate={translateX} reverse />
        </motion.div>
      ) : (
        <StillRows rows={rows} />
      )}
    </section>
  )
}
