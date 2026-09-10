import { BookOpen, Compass } from 'lucide-react'

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 bg-amber-800 shadow-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-amber-100 shrink-0">
          <BookOpen className="w-5 h-5 text-amber-800" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-white font-bold text-lg leading-tight block truncate">
            Kompas Karier &amp; Minat
          </span>
          <span className="text-amber-200 text-xs flex items-center gap-1">
            <Compass className="w-3 h-3" /> Perpustakaan Digital
          </span>
        </div>
      </div>
    </nav>
  )
}
