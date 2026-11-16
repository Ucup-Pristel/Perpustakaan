import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useReducedMotion } from '../../lib/reducedMotion'

const CarouselContext = createContext(null)

export function useCarousel() {
  const context = useContext(CarouselContext)
  if (!context) throw new Error('useCarousel harus dipakai di dalam <Carousel>')
  return context
}

export default function Carousel({ opts, setApi, className = '', children, ...props }) {
  const [carouselRef, api] = useEmblaCarousel({ align: 'start', loop: false, ...opts })
  const [viewport, setViewport] = useState(null)
  const [canScrollPrev, setCanScrollPrev] = useState(false)
  const [canScrollNext, setCanScrollNext] = useState(false)
  const wheelLock = useRef(0)
  const reduced = useReducedMotion()

  const update = useCallback(() => {
    if (!api) return
    setCanScrollPrev(api.canScrollPrev())
    setCanScrollNext(api.canScrollNext())
  }, [api])

  useEffect(() => {
    if (!api) return
    update()
    api.on('select', update)
    api.on('reInit', update)
    setApi?.(api)
    return () => {
      api.off('select', update)
      api.off('reInit', update)
    }
  }, [api, setApi, update])

  useEffect(() => {
    if (!api || !viewport) return
    const onWheel = event => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (!horizontal || Math.abs(event.deltaX) < 2) return
      event.preventDefault()
      const now = Date.now()
      if (now - wheelLock.current < 280) return
      wheelLock.current = now
      if (event.deltaX > 0) api.scrollNext(reduced)
      else api.scrollPrev(reduced)
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [api, reduced, viewport])

  const setViewportRef = useCallback(node => {
    carouselRef(node)
    setViewport(node)
  }, [carouselRef])

  const value = {
    api,
    canScrollNext,
    canScrollPrev,
    reduced,
    scrollNext: jump => api?.scrollNext(jump ?? reduced),
    scrollPrev: jump => api?.scrollPrev(jump ?? reduced),
    setViewportRef,
  }

  return (
    <CarouselContext.Provider value={value}>
      <div className={`relative ${className}`} {...props}>{children}</div>
    </CarouselContext.Provider>
  )
}

export function CarouselContent({ className = '', viewportClassName = '', children }) {
  const { setViewportRef } = useCarousel()
  return (
    <div ref={setViewportRef} className={`overflow-hidden ${viewportClassName}`} data-carousel-viewport="">
      <div className={`flex ${className}`}>{children}</div>
    </div>
  )
}

export function CarouselItem({ className = '', children, ...props }) {
  return (
    <div
      role="group"
      aria-roledescription="slide"
      className={`min-w-0 shrink-0 grow-0 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

const controlClass = 'inline-flex h-8 w-8 items-center justify-center rounded-full border border-sand bg-ivory text-ink transition-colors hover:border-clay hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-sand disabled:hover:text-ink'

export function CarouselPrevious({ className = '', children, ...props }) {
  const { canScrollPrev, scrollPrev } = useCarousel()
  return (
    <button
      type="button"
      aria-label="Geser ke kiri"
      disabled={!canScrollPrev}
      onClick={() => scrollPrev()}
      className={`${controlClass} ${className}`}
      {...props}
    >
      {children ?? <ChevronLeft className="h-4 w-4" aria-hidden="true" />}
    </button>
  )
}

export function CarouselNext({ className = '', children, ...props }) {
  const { canScrollNext, scrollNext } = useCarousel()
  return (
    <button
      type="button"
      aria-label="Geser ke kanan"
      disabled={!canScrollNext}
      onClick={() => scrollNext()}
      className={`${controlClass} ${className}`}
      {...props}
    >
      {children ?? <ChevronRight className="h-4 w-4" aria-hidden="true" />}
    </button>
  )
}
