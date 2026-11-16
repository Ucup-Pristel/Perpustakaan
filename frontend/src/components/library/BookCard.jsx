import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ExternalLink } from 'lucide-react'

function isUsableImage(url) {
  return typeof url === 'string' && url.trim().length > 0
}

function CoverFallback({ title, author }) {
  return (
    <div className="flex h-full w-full flex-col justify-between bg-[linear-gradient(150deg,var(--color-cream),var(--color-sand))] p-3 sm:p-4" data-cover-fallback="">
      <BookOpen className="h-5 w-5 text-clay-deep/70" aria-hidden="true" />
      <div>
        <p className="line-clamp-4 font-serif text-sm leading-snug text-charcoal sm:text-base">{title}</p>
        {author && <p className="mt-1 line-clamp-1 text-[10px] uppercase tracking-[0.12em] text-muted">{author}</p>}
      </div>
    </div>
  )
}

export default function BookCard({ content, priority = false }) {
  const cover = isUsableImage(content.cover_url) ? content.cover_url : null
  const [failedCover, setFailedCover] = useState(null)
  const title = content.title || 'Judul tidak tersedia'
  const author = content.author || ''
  const failed = Boolean(cover) && failedCover === cover

  const readable = content.content_type === 'pdf' && Boolean(content.file_url)
  const external = !readable && Boolean(content.source_url)
  const unavailable = !content.preview && !readable && !external

  const card = (
    <>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-sand/90 bg-cream shadow-[0_14px_30px_-24px_rgba(34,31,27,0.7)] transition-shadow duration-300 group-hover:shadow-[0_20px_38px_-24px_rgba(34,31,27,0.6)] group-focus-visible:shadow-[0_20px_38px_-24px_rgba(34,31,27,0.6)]">
        {cover && !failed ? (
          <img
            src={cover}
            alt={`Sampul ${title}`}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            onError={() => setFailedCover(cover)}
            className="h-full w-full select-none object-cover"
          />
        ) : (
          <CoverFallback title={title} author={author} />
        )}
        {external && (
          <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-charcoal/80 text-ivory">
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="mt-2 min-h-[2.5rem] px-0.5">
        <p className="line-clamp-2 text-xs font-semibold leading-snug text-charcoal">{title}</p>
        {(author || unavailable || content.preview) && (
          <p className="mt-0.5 line-clamp-1 text-[10px] text-muted">
            {author || (content.preview ? 'Pratinjau pengembangan' : 'Belum tersedia')}
          </p>
        )}
      </div>
    </>
  )

  const base = 'group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-clay'
  const cardProps = { 'data-book-card': content.id }

  if (content.preview) {
    return <div {...cardProps} className={`${base} cursor-default`} aria-label={`${title} (pratinjau pengembangan)`}>{card}</div>
  }

  if (readable) {
    return (
      <Link {...cardProps} to={`/read/${content.id}`} aria-label={`Baca ${title}${author ? ` oleh ${author}` : ''}`} className={base}>
        {card}
      </Link>
    )
  }

  if (external) {
    return (
      <a
        {...cardProps}
        href={content.source_url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Buka sumber eksternal ${title}${author ? ` oleh ${author}` : ''}`}
        className={base}
      >
        {card}
      </a>
    )
  }

  return <div {...cardProps} className={`${base} cursor-default`} aria-disabled="true" aria-label={`${title} belum tersedia`}>{card}</div>
}
