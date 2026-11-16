/**
 * Sumber kartu untuk hero parallax.
 *
 * Dua lapis, berurutan:
 *  1. Data dinamis dari API (`contents[].cover_url`) — dipakai apa adanya kalau
 *     URL-nya memang berkas gambar. Integrasi produksi tetap utuh.
 *  2. Sampul kurasi lokal di `assets/hero-covers/` — dipakai kalau backend mati,
 *     kolom cover kosong, atau URL-nya dokumen (bukan gambar).
 *
 * Komposisi hero butuh jumlah kartu yang pasti (24, 3 baris) supaya
 * parallax-nya terbentuk; karena itu daftar selalu diisi sampai TOTAL kartu.
 */

// eager: true -> Vite memberi URL final saat build, tanpa request runtime.
const coverModules = import.meta.glob('../assets/hero-covers/*.png', {
  eager: true,
  import: 'default',
})

const coverSrc = file => coverModules[`../assets/hero-covers/${file}`] || null

/**
 * Sampul sementara (portrait 2:3). Judul/penulis mengikuti baris yang sudah ada
 * di scripts/seed-db.js; berkasnya sendiri bertanda "SAMPUL SEMENTARA".
 */
const CURATED = [
  { file: 'dasar-pemasaran-digital.png', title: 'Dasar Pemasaran Digital', author: 'Philip Kotler', level: 1 },
  { file: 'strategi-seo-terkini.png', title: 'Strategi SEO Terkini', author: 'Neil Patel', level: 2 },
  { file: 'pengantar-pemrograman-python.png', title: 'Pengantar Pemrograman dengan Python', author: 'Tim Peters', level: 1 },
  { file: 'clean-code.png', title: 'Clean Code', author: 'Robert C. Martin', level: 3 },
  { file: 'statistika-untuk-data-science.png', title: 'Statistika untuk Data Science', author: 'Hadley Wickham', level: 2 },
  { file: 'anatomi-tubuh-manusia.png', title: 'Anatomi Tubuh Manusia', author: 'Frank Netter', level: 2 },
  { file: 'metode-montessori.png', title: 'Metode Montessori', author: 'Maria Montessori', level: 1 },
  { file: 'prinsip-desain-grafis.png', title: 'Prinsip Desain Grafis', author: 'Robin Williams', level: 1 },
  { file: 'teori-akuntansi-dasar.png', title: 'Teori Akuntansi Dasar', author: 'Sugiri', level: 2 },
  { file: 'manajemen-sumber-daya-manusia.png', title: 'Manajemen Sumber Daya Manusia', author: 'Mondy', level: 2 },
  { file: 'logika-dan-algoritma.png', title: 'Logika dan Algoritma', author: 'Rinaldi Munir', level: 2 },
  { file: 'pengantar-kecerdasan-artifisial.png', title: 'Pengantar Kecerdasan Artifisial', author: 'Russell & Norvig', level: 3 },
  { file: 'fisiologi-manusia.png', title: 'Fisiologi Manusia', author: 'Guyton & Hall', level: 3 },
  { file: 'psikologi-anak-usia-dini.png', title: 'Psikologi Anak Usia Dini', author: 'Sujiono', level: 2 },
  { file: 'tipografi-dan-tata-letak.png', title: 'Tipografi dan Tata Letak', author: 'Sihombing', level: 2 },
  { file: 'riset-operasi.png', title: 'Riset Operasi', author: 'Taha', level: 3 },
  { file: 'keuangan-korporat.png', title: 'Keuangan Korporat', author: 'Brigham', level: 3 },
  { file: 'buku-kurikulum-2024.png', title: 'Buku Kurikulum 2024', author: 'Program Studi', level: 1 },
  { file: 'operasi-dan-rantai-pasok.png', title: 'Manajemen Operasi & Rantai Pasok', author: 'Heizer & Render', level: 3 },
  { file: 'sistem-informasi-manajemen.png', title: 'Sistem Informasi Manajemen', author: 'Laudon & Laudon', level: 2 },
  { file: 'pariwisata-dan-perhotelan.png', title: 'Manajemen Pariwisata & Perhotelan', author: 'Pendit', level: 1 },
  { file: 'kewirausahaan.png', title: 'Kewirausahaan', author: 'Zimmerer', level: 1 },
  { file: 'gizi-dan-kesehatan.png', title: 'Ilmu Gizi & Kesehatan', author: 'Almatsier', level: 2 },
  { file: 'kurikulum-dan-pembelajaran.png', title: 'Kurikulum dan Pembelajaran', author: 'Sanjaya', level: 2 },
].map(item => ({ ...item, src: coverSrc(item.file) })).filter(item => item.src)

/** 3 baris × 8 kartu. Angka ini yang menjaga komposisi "penuh layar". */
export const ROWS = 3
export const ROW_SIZE = 8
export const TOTAL_CARDS = ROWS * ROW_SIZE

const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|svg)(\?.*)?$/i

/** Sampul hanya dipakai kalau memang berkas gambar, bukan dokumen PDF. */
export function isImageUrl(url) {
  return Boolean(url) && IMAGE_EXT.test(url)
}

const normalize = value => String(value || '').trim().toLowerCase()

/** Sampul kurasi untuk satu konten, dipakai juga oleh showcase di landing. */
export function curatedForContent(content, index = 0) {
  if (!CURATED.length) return null
  const byTitle = CURATED.find(item => normalize(item.title) === normalize(content?.title))
  return byTitle || CURATED[index % CURATED.length]
}

/**
 * Kartu hero: data API diutamakan, lalu diisi sampul kurasi sampai TOTAL_CARDS.
 * Tidak pernah mengembalikan daftar kosong selama aset lokal tersedia.
 */
export function buildHeroCards(contents = []) {
  const used = new Set()
  const cards = []

  // Sampul kurasi berikutnya yang belum terpakai, untuk mengisi slot atau
  // menjadi cadangan kalau gambar API gagal dimuat.
  const takeCurated = () => {
    const item = CURATED.find(entry => !used.has(entry.file))
    if (item) used.add(item.file)
    return item || null
  }

  for (const content of contents) {
    if (cards.length >= TOTAL_CARDS) break
    const realCover = isImageUrl(content?.cover_url) ? content.cover_url : null

    if (realCover) {
      const match = CURATED.find(
        item => !used.has(item.file) && normalize(item.title) === normalize(content?.title)
      )
      // Selalu siapkan cadangan kalau URL API gagal dimuat.
      const fallback = match || takeCurated()
      if (fallback) used.add(fallback.file)
      cards.push({
        key: `content-${content.id}`,
        title: content.title,
        author: content.author,
        level: content.level,
        src: realCover,
        fallbackSrc: fallback?.src || null,
        link: '/library',
      })
      continue
    }

    const placeholder = CURATED.find(
      item => !used.has(item.file) && normalize(item.title) === normalize(content?.title)
    ) || takeCurated()

    if (placeholder) {
      used.add(placeholder.file)
      cards.push({
        key: `content-${content.id}`,
        title: content.title,
        author: content.author,
        level: placeholder.level,
        src: placeholder.src,
        link: '/library',
      })
    }
  }

  let extra
  while (cards.length < TOTAL_CARDS && (extra = takeCurated())) {
    cards.push({
      key: `curated-${extra.file}`,
      title: extra.title,
      author: extra.author,
      level: extra.level,
      src: extra.src,
      link: '/library',
    })
  }

  return cards
}

/** Pecah kartu menjadi baris-baris untuk komposisi tiga baris. */
export function splitRows(cards) {
  return Array.from({ length: ROWS }, (_, row) =>
    cards.slice(row * ROW_SIZE, row * ROW_SIZE + ROW_SIZE)
  )
}
