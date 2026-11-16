import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import Carousel, {
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  useCarousel,
} from '../ui/Carousel'
import BookCard from './BookCard'

function ShelfControls() {
  const { canScrollNext, canScrollPrev } = useCarousel()
  if (!canScrollNext && !canScrollPrev) return null

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <CarouselPrevious />
      <CarouselNext />
    </div>
  )
}

export default function BookShelf({ title, books = [], href, priority = false }) {
  if (!books.length) return null

  return (
    <Carousel
      opts={{ align: 'start', loop: false, containScroll: 'trimSnaps' }}
      role="region"
      aria-roledescription="carousel"
      aria-label={`Rak ${title}`}
      data-shelf={title}
    >
      <div className="mb-3 flex items-end justify-between gap-4">
        {href ? (
          <Link
            to={href}
            className="group inline-flex items-baseline gap-1.5 font-serif text-xl tracking-tight text-charcoal transition-colors hover:text-clay-deep focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-clay sm:text-2xl"
          >
            {title}
            <ArrowUpRight
              className="h-3.5 w-3.5 translate-y-0.5 text-muted transition-colors group-hover:text-clay-deep"
              aria-hidden="true"
            />
          </Link>
        ) : (
          <h2 className="font-serif text-xl tracking-tight text-charcoal sm:text-2xl">{title}</h2>
        )}
        <ShelfControls />
      </div>

      <CarouselContent className="-ml-3 sm:-ml-4">
        {books.map((book, index) => (
          <CarouselItem
            key={book.id}
            className="basis-[43%] pl-3 sm:basis-[29%] sm:pl-4 md:basis-[22.5%] lg:basis-[18%] xl:basis-[13.3%]"
          >
            <BookCard content={book} priority={priority && index < 6} />
          </CarouselItem>
        ))}
      </CarouselContent>
    </Carousel>
  )
}
