import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useReducedMotion } from '../../lib/reducedMotion'

const ALL = { id: 'all', name: 'Semua' }

export default function CategoryPills({ categories = [], active = 'all', onChange }) {
  const reduced = useReducedMotion()
  const items = [ALL, ...categories.map(category => ({ ...category, id: String(category.id) }))]
  const shellRef = useRef(null)
  const scrollRef = useRef(null)
  const contentRef = useRef(null)
  const itemRefs = useRef(new Map())
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false })

  const updateEdges = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth)
    const next = {
      overflow: scroll.scrollWidth > scroll.clientWidth + 1,
      left: scroll.scrollLeft > 1,
      right: scroll.scrollLeft < max - 1,
    }
    setEdges(previous => (
      previous.overflow === next.overflow && previous.left === next.left && previous.right === next.right
        ? previous
        : next
    ))
  }, [])

  const reveal = useCallback(node => {
    const scroll = scrollRef.current
    if (!scroll || !node) return
    const frame = scroll.getBoundingClientRect()
    const item = node.getBoundingClientRect()
    const delta = item.left < frame.left
      ? item.left - frame.left - 8
      : item.right > frame.right
        ? item.right - frame.right + 8
        : 0
    if (delta) scroll.scrollBy({ left: delta, behavior: reduced ? 'auto' : 'smooth' })
  }, [reduced])

  useLayoutEffect(() => {
    const shell = shellRef.current
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!shell || !scroll) return
    const observer = new ResizeObserver(updateEdges)
    observer.observe(shell)
    observer.observe(scroll)
    if (content) observer.observe(content)
    scroll.addEventListener('scroll', updateEdges, { passive: true })
    updateEdges()
    const frame = window.requestAnimationFrame(updateEdges)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      scroll.removeEventListener('scroll', updateEdges)
    }
  }, [updateEdges])

  useLayoutEffect(() => {
    reveal(itemRefs.current.get(active) ?? null)
  }, [active, reveal])

  const scrollByPage = direction => {
    const scroll = scrollRef.current
    if (!scroll) return
    scroll.scrollBy({
      left: direction * scroll.clientWidth * 0.75,
      behavior: reduced ? 'auto' : 'smooth',
    })
  }

  const focusItem = index => {
    const item = items[index]
    const node = itemRefs.current.get(item.id)
    if (node) {
      node.focus()
      reveal(node)
    }
  }

  const onKeyDown = (event, index) => {
    let next = null
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    if (next === null) return
    event.preventDefault()
    focusItem(next)
  }

  return (
    <div className="flex items-center gap-2">
      {edges.overflow && (
        <button
          type="button"
          onClick={() => scrollByPage(-1)}
          disabled={!edges.left}
          aria-label="Geser kategori ke kiri"
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sand bg-ivory text-ink transition-colors hover:border-clay hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay disabled:cursor-not-allowed disabled:opacity-35 sm:inline-flex"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      <div ref={shellRef} className="relative min-w-0 flex-1">
        <div
          ref={scrollRef}
          role="group"
          aria-label="Filter kategori koleksi"
          className="no-scrollbar flex gap-2 overflow-x-auto py-1"
        >
          <div ref={contentRef} className="flex gap-2">
            {items.map((item, index) => {
              const selected = active === item.id
              return (
                <button
                  key={item.id}
                  ref={node => {
                    if (node) itemRefs.current.set(item.id, node)
                    else itemRefs.current.delete(item.id)
                  }}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange?.(item.id)}
                  onFocus={event => reveal(event.currentTarget)}
                  onKeyDown={event => onKeyDown(event, index)}
                  className={`relative shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay ${
                    selected
                      ? 'border-clay-deep text-ivory'
                      : 'border-sand bg-cream/60 text-ink/75 hover:border-clay/45 hover:text-charcoal'
                  }`}
                >
                  {selected && (
                    <motion.span
                      layoutId="edulib-library-active-pill"
                      className="absolute inset-0 rounded-full bg-clay-deep"
                      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10">{item.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        {edges.left && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-ivory to-transparent"
          />
        )}
        {edges.right && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-ivory to-transparent"
          />
        )}
      </div>

      {edges.overflow && (
        <button
          type="button"
          onClick={() => scrollByPage(1)}
          disabled={!edges.right}
          aria-label="Geser kategori ke kanan"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sand bg-ivory text-ink transition-colors hover:border-clay hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
