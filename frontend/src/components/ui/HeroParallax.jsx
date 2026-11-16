import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useScroll, useTransform, useSpring } from 'framer-motion'
import { ArrowDown, ArrowRight, LibraryBig } from 'lucide-react'
import { useReducedMotion } from '../../lib/reducedMotion'
import { splitRows } from '../../lib/heroCovers'
import './HeroParallax.css'

// Aceternity Hero Parallax: https://ui.aceternity.com/components/hero-parallax
// Keep the opening tilt/reveal on the first 20% of scroll, then let the three
// rows continue their opposing travel. Portrait covers change layout, not timing.
const SPRING = { stiffness: 300, damping: 30, bounce: 100 }
const REVEAL = [0, 0.2]

function BookCard({ card, priority = false, reduced = false }) {
  const [failedSources, setFailedSources] = useState([])
  // Track failed URLs, not a copy of props: refreshed API covers must update
  // even when the content id is unchanged. Never loop on a broken fallback.
  const src = [card.src, card.fallbackSrc].find(url => url && !failedSources.includes(url))

  return (
    <motion.li
      className="hero-book group/book relative shrink-0"
      whileHover={reduced ? undefined : { y: -16 }}
      transition={SPRING}
    >
      <Link
        to={card.link}
        tabIndex={reduced ? undefined : -1}
        aria-label={`${card.title} — buka perpustakaan`}
        className="block h-full w-full overflow-hidden rounded-md bg-cream shadow-[0_18px_40px_-18px_rgba(34,31,27,0.55)] ring-1 ring-charcoal/10 transition-shadow duration-300 group-hover/book:shadow-[0_28px_60px_-20px_rgba(34,31,27,0.6)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-clay"
      >
        {src ? (
          <img
            src={src}
            alt={`Sampul ${card.title}`}
            width="600"
            height="900"
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            onError={() => setFailedSources(previous => [...previous, src])}
            className="h-full w-full select-none object-cover"
          />
        ) : (
          <span className="flex h-full items-center p-5 font-serif text-lg text-charcoal">{card.title}</span>
        )}
      </Link>
    </motion.li>
  )
}

/** Header landing; sengaja berada di luar wrapper 3D agar tidak ikut berotasi. */
function HeroHeader() {
  return (
    <div className="hero-header relative z-10 mx-auto max-w-6xl px-4 pt-14 sm:px-6 sm:pt-16 lg:px-8">
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

function BookRow({ cards, translate, reverse, reduced = false, index }) {
  return (
    <motion.ul
      aria-label={`Koleksi buku, baris ${index + 1}`}
      data-parallax-row={index}
      style={translate ? { x: translate } : undefined}
      className={`hero-book-row flex ${reverse ? 'flex-row-reverse' : ''}`}
    >
      {cards.map(card => (
        <BookCard key={`${card.key}:${card.src}`} card={card} priority={index === 0} reduced={reduced} />
      ))}
    </motion.ul>
  )
}

function HeroBackground() {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,rgba(198,93,40,0.14),transparent_65%)]" />
}

function AnimatedHero({ rows }) {
  const ref = useRef(null)
  const [geometry, setGeometry] = useState(() => ({
    scale: typeof window === 'undefined' ? 1 : Math.min(1, window.innerWidth / 1280),
    travel: 1000,
  }))

  useLayoutEffect(() => {
    const section = ref.current
    const measure = () => {
      const row = section.querySelector('[data-parallax-row]')
      const card = row?.firstElementChild
      if (!card) return
      const gap = parseFloat(getComputedStyle(row).columnGap)
      const rowWidth = card.offsetWidth * row.children.length + gap * (row.children.length - 1)
      const next = {
        scale: Math.min(1, section.clientWidth / 1280),
        // Like the reference, anchor right-moving rows to the right and the
        // left-moving row to the left. Reserve overscan so no edge runs out of
        // covers on wide screens or after a resize.
        travel: Math.max(0, Math.min(1000, rowWidth - section.clientWidth - gap * 2)),
      }
      setGeometry(previous => previous.scale === next.scale && previous.travel === next.travel ? previous : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(section)
    return () => observer.disconnect()
  }, [])

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const translateX = useSpring(useTransform(scrollYProgress, [0, 1], [0, geometry.travel]), SPRING)
  const translateXReverse = useTransform(translateX, value => -value)
  const rotateX = useSpring(useTransform(scrollYProgress, REVEAL, [15, 0]), SPRING)
  const rotateZ = useSpring(useTransform(scrollYProgress, REVEAL, [20, 0]), SPRING)
  const opacity = useSpring(useTransform(scrollYProgress, REVEAL, [0.2, 1]), SPRING)
  const translateY = useSpring(useTransform(scrollYProgress, REVEAL, [-700 * geometry.scale, 500 * geometry.scale]), SPRING)

  return (
    <section ref={ref} aria-labelledby="hero-title" className="hero-parallax hero-parallax--animated relative bg-ivory" style={{ '--hero-settle': `${500 * geometry.scale}px` }}>
      <HeroBackground />
      <HeroHeader />
      {/* Every cover opens the same library as the header CTA. Keep this moving,
          clipped illustration out of the tab order; the static alternative
          remains accessible when reduced motion is requested. */}
      <motion.div aria-hidden="true" className="hero-book-plane" style={{ rotateX, rotateZ, y: translateY, opacity }}>
        {rows.map((cards, index) => (
          <BookRow key={index} cards={cards} index={index} reverse={index !== 1} translate={index === 1 ? translateXReverse : translateX} />
        ))}
      </motion.div>
    </section>
  )
}

export default function HeroParallax({ cards = [] }) {
  const reduced = useReducedMotion()
  const rows = splitRows(cards)

  // Unmount scroll/spring subscriptions entirely when motion is reduced. The
  // compact shelves remain touch- and keyboard-scrollable, with no hover lift.
  if (reduced || !cards.length) {
    return (
      <section aria-labelledby="hero-title" className="hero-parallax hero-parallax--still relative bg-ivory">
        <HeroBackground />
        <HeroHeader />
        <div className="hero-book-plane">
          {rows.map((row, index) => <BookRow key={index} cards={row} index={index} reduced />)}
        </div>
      </section>
    )
  }

  return <AnimatedHero rows={rows} />
}
