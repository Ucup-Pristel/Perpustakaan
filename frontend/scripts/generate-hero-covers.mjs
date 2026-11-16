/**
 * Generate the temporary hero-cover set (portrait 2:3, 600×900 PNG).
 *
 * These are temporary illustrations for the landing hero while the backend /
 * R2 is offline. They are NOT real book covers — every one carries a
 * "SAMPUL SEMENTARA" badge. Real covers come from `contents.cover_url`.
 *
 * Usage (from frontend/):  node scripts/generate-hero-covers.mjs
 * Requires: rsvg-convert
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'src', 'assets', 'hero-covers')
const tmpDir = join(here, '..', '.cover-tmp')

const W = 600
const H = 900

const MOTIFS = {
  waves: (c) => `<path d="M0 520 C150 440 300 600 450 520 S600 460 600 520 L600 900 L0 900 Z" fill="${c.soft}"/>
    <path d="M0 600 C150 520 300 680 450 600 S600 540 600 600" fill="none" stroke="${c.accent}" stroke-width="10" opacity=".55"/>`,
  grid: (c) => `<g stroke="${c.accent}" stroke-width="2" opacity=".28">
      ${Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${380 + i * 58}" x2="600" y2="${380 + i * 58}"/>`).join('')}
      ${Array.from({ length: 6 }, (_, i) => `<line x1="${i * 120}" y1="380" x2="${i * 120}" y2="900"/>`).join('')}
    </g>`,
  arch: (c) => `<path d="M110 900 L110 560 A190 190 0 0 1 490 560 L490 900 Z" fill="${c.soft}"/>
    <path d="M170 900 L170 580 A130 130 0 0 1 430 580 L430 900 Z" fill="${c.accent}" opacity=".35"/>`,
  circles: (c) => `<circle cx="470" cy="250" r="150" fill="${c.accent}" opacity=".22"/>
    <circle cx="140" cy="760" r="190" fill="${c.soft}"/>
    <circle cx="140" cy="760" r="110" fill="none" stroke="${c.accent}" stroke-width="10" opacity=".45"/>`,
  steps: (c) => `<g fill="${c.soft}">
      <rect x="60" y="760" width="480" height="140"/>
      <rect x="110" y="640" width="380" height="120"/>
      <rect x="160" y="520" width="280" height="120"/>
      <rect x="210" y="400" width="180" height="120"/>
    </g><rect x="60" y="748" width="480" height="10" fill="${c.accent}" opacity=".6"/>`,
  leaf: (c) => `<path d="M300 900 C300 640 160 560 110 380 C300 400 470 520 470 720 C470 820 400 880 300 900 Z" fill="${c.soft}"/>
    <path d="M300 900 C300 700 320 560 380 430" fill="none" stroke="${c.accent}" stroke-width="9" opacity=".6"/>`,
}

const PALETTES = [
  { bg: '#f3ece0', ink: '#221f1b', accent: '#c65d28', soft: '#e6dccb' },
  { bg: '#eee8db', ink: '#241f1a', accent: '#4d6a45', soft: '#dde3d4' },
  { bg: '#efe6da', ink: '#221f1b', accent: '#8a5a2b', soft: '#e2d3bf' },
  { bg: '#eae4d8', ink: '#232019', accent: '#5d4a3a', soft: '#d8cdbb' },
  { bg: '#f2e9dd', ink: '#241f1b', accent: '#a8481c', soft: '#e8d2c2' },
]

// Mapping to seeded contents (scripts/seed-db.js) plus stable generic fill entries.
const BOOKS = [
  { file: 'dasar-pemasaran-digital', title: 'Dasar Pemasaran Digital', author: 'Philip Kotler', label: 'Manajemen', motif: 'waves', p: 0 },
  { file: 'strategi-seo-terkini', title: 'Strategi SEO Terkini', author: 'Neil Patel', label: 'Manajemen', motif: 'grid', p: 1 },
  { file: 'pengantar-pemrograman-python', title: 'Pengantar Pemrograman dengan Python', author: 'Tim Peters', label: 'Teknologi', motif: 'arch', p: 2 },
  { file: 'clean-code', title: 'Clean Code', author: 'Robert C. Martin', label: 'Teknologi', motif: 'steps', p: 3 },
  { file: 'statistika-untuk-data-science', title: 'Statistika untuk Data Science', author: 'Hadley Wickham', label: 'Ilmu Data', motif: 'circles', p: 4 },
  { file: 'anatomi-tubuh-manusia', title: 'Anatomi Tubuh Manusia', author: 'Frank Netter', label: 'Kesehatan', motif: 'leaf', p: 0 },
  { file: 'metode-montessori', title: 'Metode Montessori', author: 'Maria Montessori', label: 'Pendidikan', motif: 'steps', p: 1 },
  { file: 'prinsip-desain-grafis', title: 'Prinsip Desain Grafis', author: 'Robin Williams', label: 'Seni & Kreativitas', motif: 'circles', p: 2 },
  { file: 'teori-akuntansi-dasar', title: 'Teori Akuntansi Dasar', author: 'Sugiri', label: 'Manajemen', motif: 'grid', p: 3 },
  { file: 'manajemen-sumber-daya-manusia', title: 'Manajemen Sumber Daya Manusia', author: 'Mondy', label: 'Manajemen', motif: 'arch', p: 4 },
  { file: 'logika-dan-algoritma', title: 'Logika dan Algoritma', author: 'Rinaldi Munir', label: 'Teknologi', motif: 'waves', p: 1 },
  { file: 'pengantar-kecerdasan-artifisial', title: 'Pengantar Kecerdasan Artifisial', author: 'Russell & Norvig', label: 'Teknologi', motif: 'circles', p: 0 },
  { file: 'fisiologi-manusia', title: 'Fisiologi Manusia', author: 'Guyton & Hall', label: 'Kesehatan', motif: 'waves', p: 2 },
  { file: 'psikologi-anak-usia-dini', title: 'Psikologi Anak Usia Dini', author: 'Sujiono', label: 'Pendidikan', motif: 'leaf', p: 3 },
  { file: 'tipografi-dan-tata-letak', title: 'Tipografi dan Tata Letak', author: 'Sihombing', label: 'Seni & Kreativitas', motif: 'grid', p: 4 },
  { file: 'riset-operasi', title: 'Riset Operasi', author: 'Taha', label: 'Ilmu Data', motif: 'steps', p: 0 },
  { file: 'keuangan-korporat', title: 'Keuangan Korporat', author: 'Brigham', label: 'Manajemen', motif: 'arch', p: 1 },
  { file: 'buku-kurikulum-2024', title: 'Buku Kurikulum 2024', author: 'Program Studi', label: 'Perpustakaan', motif: 'steps', p: 2 },
  { file: 'operasi-dan-rantai-pasok', title: 'Manajemen Operasi & Rantai Pasok', author: 'Heizer & Render', label: 'Manajemen', motif: 'steps', p: 3 },
  { file: 'sistem-informasi-manajemen', title: 'Sistem Informasi Manajemen', author: 'Laudon & Laudon', label: 'Manajemen', motif: 'grid', p: 4 },
  { file: 'pariwisata-dan-perhotelan', title: 'Manajemen Pariwisata & Perhotelan', author: 'Pendit', label: 'Manajemen', motif: 'waves', p: 0 },
  { file: 'kewirausahaan', title: 'Kewirausahaan', author: 'Zimmerer', label: 'Manajemen', motif: 'arch', p: 1 },
  { file: 'gizi-dan-kesehatan', title: 'Ilmu Gizi & Kesehatan', author: 'Almatsier', label: 'Kesehatan', motif: 'leaf', p: 2 },
  { file: 'kurikulum-dan-pembelajaran', title: 'Kurikulum dan Pembelajaran', author: 'Sanjaya', label: 'Pendidikan', motif: 'circles', p: 3 },
]

// SVG text wrapping: max characters per line, tuned for the 600px canvas.
const wrap = (text, max = 15) => {
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const word of words) {
    if ((line + ' ' + word).trim().length > max && line) {
      lines.push(line)
      line = word
    } else {
      line = (line + ' ' + word).trim()
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 4)
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const svg = (book) => {
  const c = PALETTES[book.p % PALETTES.length]
  const titleLines = wrap(book.title)
  const titleSize = titleLines.length > 3 ? 44 : 54
  const titleLineHeight = titleSize * 1.14
  // Judul di-anchor bottom: baris terakhir selalu mendarat di baseline yang
  // sama, sehingga tidak pernah menabrak baris penulis di bawahnya.
  const titleBaseline = H - 230
  const titleY = titleBaseline - (titleLines.length - 1) * titleLineHeight
  const titleSvg = titleLines
    .map((l, i) => `<tspan x="56" dy="${i === 0 ? 0 : titleLineHeight}">${esc(l)}</tspan>`)
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${c.bg}"/>
  ${MOTIFS[book.motif](c)}
  <rect x="0" y="0" width="14" height="${H}" fill="${c.accent}"/>

  <g font-family="Georgia, 'Times New Roman', serif">
    <text x="56" y="88" font-size="17" letter-spacing="5" fill="${c.accent}">EDULIB</text>
    <line x1="56" y1="112" x2="140" y2="112" stroke="${c.accent}" stroke-width="3"/>
    <text x="56" y="${titleY}" font-size="${titleSize}" fill="${c.ink}" font-weight="600">${titleSvg}</text>
    <text x="56" y="${H - 158}" font-size="22" fill="${c.ink}" opacity=".62">${esc(book.author)}</text>
  </g>

  <g font-family="Inter, Helvetica, Arial, sans-serif">
    <text x="56" y="${H - 72}" font-size="15" letter-spacing="2" fill="${c.ink}" opacity=".45">${esc(book.label.toUpperCase())}</text>
    <text x="${W - 56}" y="${H - 72}" text-anchor="end" font-size="13" letter-spacing="1.5" fill="${c.accent}" opacity=".8">SAMPUL SEMENTARA</text>
  </g>
</svg>`
}

mkdirSync(outDir, { recursive: true })
mkdirSync(tmpDir, { recursive: true })

for (const book of BOOKS) {
  const svgPath = join(tmpDir, `${book.file}.svg`)
  const pngPath = join(outDir, `${book.file}.png`)
  writeFileSync(svgPath, svg(book))
  execFileSync('rsvg-convert', ['-w', String(W), '-h', String(H), '-o', pngPath, svgPath])
  console.log('wrote', pngPath)
}

rmSync(tmpDir, { recursive: true, force: true })
