import { Link } from 'react-router-dom'
import { BookMarked, Compass, GraduationCap, Layers } from 'lucide-react'

const FOOTER_CONTACT = {
  email: 'rasyidaulia@edulib.id',
  phone: '+62 813 8565 5971',
  phoneHref: 'tel:+6281385655971',
  address: 'Jl. Tapir Raya No.30 N-1',
  website: 'https://edulib.id',
}

const PAGE_LINKS = [
  { label: 'Beranda', to: '/', hash: '' },
  { label: 'Tentang', to: '/', hash: 'tentang' },
  { label: 'Fitur', to: '/', hash: 'fitur' },
  { label: 'Misi', to: '/', hash: 'misi' },
]

const PRODUCT_LINKS = [
  { label: 'Perpustakaan Digital', to: '/library', icon: BookMarked },
  { label: 'Eksplorasi Karier', to: '/library', icon: Compass },
  { label: 'Cari Materi', to: '/search', icon: Layers },
  { label: 'Masuk', to: '/login', icon: GraduationCap },
]

/**
 * Footer landing. Kontak diambil dari FOOTER_CONTACT supaya hanya ada satu
 * sumber kebenaran — tidak ada klaim bisnis di luar data yang diberikan.
 *
 * Link halaman memakai `/` + hash: dari halaman mana pun, klik akan membuka
 * landing lalu menggulir ke bagiannya tanpa perlu logika scroll manual.
 */
export default function LandingFooter() {
  const { email, phone, phoneHref, address, website } = FOOTER_CONTACT

  return (
    <footer className="border-t border-sand bg-charcoal text-ivory">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-clay text-ivory">
                <BookMarked className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="font-serif text-xl tracking-tight">Edulib</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ivory/60">
              Perpustakaan digital dan ruang eksplorasi minat serta karier untuk pelajar dan pendidik.
            </p>
          </div>

          <nav aria-labelledby="footer-halaman">
            <h2 id="footer-halaman" className="text-xs font-semibold uppercase tracking-[0.18em] text-ivory/50">
              Halaman
            </h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {PAGE_LINKS.map(({ label, to, hash }) => (
                <li key={label}>
                  <Link to={`${to}${hash ? `#${hash}` : ''}`} className="text-ivory/75 transition hover:text-ivory">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-platform">
            <h2 id="footer-platform" className="text-xs font-semibold uppercase tracking-[0.18em] text-ivory/50">
              Platform
            </h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {PRODUCT_LINKS.map(({ label, to, icon: Icon }) => (
                <li key={label}>
                  <Link to={to} className="inline-flex items-center gap-2 text-ivory/75 transition hover:text-ivory">
                    <Icon className="h-3.5 w-3.5 text-clay" aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2
              id="footer-kontak"
              className="text-xs font-semibold uppercase tracking-[0.18em] text-ivory/50"
            >
              Kontak
            </h2>
            <address className="mt-4 space-y-2.5 text-sm not-italic text-ivory/75">
              <p>{address}</p>
              <p>
                <a href={`mailto:${email}`} className="transition hover:text-ivory">
                  {email}
                </a>
              </p>
              <p>
                <a href={phoneHref} className="transition hover:text-ivory">
                  {phone}
                </a>
              </p>
              <p>
                <a href={website} className="transition hover:text-ivory" rel="noreferrer">
                  edulib.id
                </a>
              </p>
            </address>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-ivory/10 pt-6 text-xs text-ivory/45 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Edulib. Hak cipta dilindungi.</p>
          <p>Dibangun untuk pembelajaran yang lebih terarah.</p>
        </div>
      </div>
    </footer>
  )
}
