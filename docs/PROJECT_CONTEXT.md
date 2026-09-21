# DOKUMEN KONTEKS: PERPUSTAKAAN DIGITAL KOMPAS KARIER & MINAT
## ucup-edu-lib v1.0.0-alpha

**Terakhir Diperbarui: Senin, 14 September 2026**

---

## 1. VISI & MISI

### Visi
Membangun perpustakaan digital yang berfungsi sebagai "kompas karier dan minat" bagi siswa SMA/sederajat — bukan sekadar perpustakaan biasa. Perpustakaan ini bertindak sebagai **jembatan** dari bacaan ringan menuju literatur akademis.

### Misi
1. Membantu siswa menemukan jalur karier dan jurusan kuliah melalui eksplorasi bacaan bertingkat.
2. Menyediakan konten yang dikurasi dengan sistem gradasi kesulitan (Level 1–4).
3. Menggantikan kategori subjek kaku dengan kategori berbasis "Pohon Minat & Jurusan".
4. Memberikan gambaran nyata tentang apa yang dipelajari di bangku kuliah sebelum siswa memilih jurusan.

---

## 2. PRINSIP DASAR

### 2.1 Kategorisasi Berbasis "Pohon Minat & Jurusan"
Alih-alih kategori kaku seperti "Fisika" atau "Sosiologi", gunakan kategori yang mencerminkan jalur karier atau jurusan kuliah. Setiap jalur memiliki sub-bidang yang terstruktur seperti pohon (tree structure).

### 2.2 Kurasi Konten Bertingkat (Gradasi Kesulitan)

| Level | Nama | Deskripsi | Contoh Konten |
|-------|------|-----------|---------------|
| **Level 1** | Eksplorasi | Memicu imajinasi dan rasa ingin tahu | Buku fiksi ilmiah, novel sejarah, majalah sains populer |
| **Level 2** | Pengantar | Membangun fondasi pemahaman | Buku teks non-fiksi, ensiklopedia, artikel open access ringan |
| **Level 3** | Pendalaman | Memperdalam pemahaman terstruktur | Review paper, buku akademis menengah |
| **Level 4** | Pra-Kuliah | Gambaran nyata perkuliahan | Jurnal ilmiah, paper riset konferensi, skripsi open access |

### 2.3 Prinsip Jembatan
Setiap jalur harus memiliki alur yang jelas dari Level 1 → Level 4. UI/UX harus memvisualisasikan progres ini.

---

## 3. STRUKTUR POHON MINAT (MASTER TREE)

### 3.1 BIDANG MANAJEMEN (Priority: PERTAMA DIBANGUN)

```
MANAJEMEN
├── Manajemen Pemasaran (Marketing)
├── Manajemen Keuangan & Akuntansi
├── Manajemen Sumber Daya Manusia (HRD)
├── Manajemen Operasi & Supply Chain
├── Manajemen Informatika & Sistem Informasi
├── Manajemen Pariwisata & Perhotelan
└── Kewirausahaan (Entrepreneurship)
```

Setiap sub-bidang memiliki konten dari Level 1 (fiksi/populer) hingga Level 4 (jurnal ilmiah/skripsi).

### 3.2 BIDANG LAIN (ROADMAP MASA DEPAN)
- Rekayasa & Teknologi *(sebagian sudah ada di database — sub-bidang Teknik Komputer)*
- Medis & Kesehatan
- Seni & Desain
- Hukum & Politik
- Sains & Matematika
- Sosial & Humaniora
- Pendidikan
- Pertanian & Lingkungan

---

## 4. ARSITEKTUR NAVIGASI

| Halaman | Route | Status |
|---------|-------|--------|
| Homepage | `/` | Selesai |
| Login | `/login` | Selesai |
| Register | `/register` | Selesai |
| Daftar Konten per Bidang | `/field/:fieldId` | Selesai |
| Reader PDF | `/read/:contentId` | Selesai |
| Dashboard Pengguna | `/dashboard` | Selesai |
| Hasil Pencarian | `/search?q=...` | Selesai |
| Admin Backoffice | `/admin` | Selesai |

---

## 5. FITUR & STATUS IMPLEMENTASI

### 5.1 Selesai

- **Autentikasi JWT:** Register, login, sesi dari `localStorage`, navbar adaptif.
- **Inisialisasi Database:** Skrip idempoten `database/init.js` + `schema.sql`, seed awal, migrasi kolom tambahan secara otomatis.
- **Reader PDF (Continuous Scroll):** Memuat PDF dari URL R2, continuous scroll via `Array.from` + `IntersectionObserver`, lazy render ±2 halaman agar tidak crash di PDF tebal.
- **Progress Tracking:** Auto-save halaman terakhir dengan debounce 600 ms ke `POST /api/activity/reading-progress`. Saat PDF dimuat, posisi terakhir dipulihkan via `GET`.
- **Panel Catatan per Halaman:** Fetch catatan otomatis saat halaman berubah, simpan/update via `POST /api/activity/notes`. Upsert per `(user_id, content_id, page_number)`.
- **User Dashboard:** Menampilkan "Terakhir Dibaca" dan "Koleksi Catatan" dari `GET /api/activity/summary`.
- **Smart Search Engine:** Fuse.js (threshold 0.4, `ignoreLocation: true`, `distance: 100`) dengan kamus sinonim (`queryParser.js`). Mencari di `title`, `author`, `description` (termasuk `sub_field_name` dan `field_name`). Search sekaligus raw query + parsed query, dedup by ID.
- **Search Bar Navbar:** Debounce 500 ms, dropdown hasil, Enter → navigate ke `/search?q=...`.
- **Halaman Hasil Pencarian (`SearchResults.jsx`):** Grid kartu buku portrait (aspect 3:4), sampul dari `cover_url` atau fallback ikon, deskripsi tersembunyi dari UI tapi tetap diindeks Fuse.
- **Admin Backoffice (`/admin`):** Upload PDF + sampul gambar ke Cloudflare R2, insert ke SQLite, tabel daftar konten dengan thumbnail sampul, hapus konten.
- **Upload Multi-file ke R2:** Multer `memoryStorage` + `.fields([{name:'pdf'},{name:'cover'}])`. Nama file diacak `<base>-<timestamp>-<hex><ext>`. PDF ke prefix `pdfs/`, gambar ke `covers/`. MIME otomatis per ekstensi.

### 5.2 Diparkir / Backlog

- Bug pada penyimpanan catatan di panel Reader PDF — belum final.
- Typo-tolerance tingkat lanjut Fuse.js ("computer" vs "komputer") belum optimal meski threshold sudah dilonggarkan.
- Visualisasi pohon minat interaktif (expand/collapse) di homepage.
- Sistem rekomendasi Level N → Level N+1.
- Fitur komunitas diskusi per jalur.
- Mobile app / PWA.

---

## 6. KONTEN & KURASI

### 6.1 Sumber Konten (Legal & Open Access)
- Google Scholar (artikel open access)
- Directory of Open Access Journals (DOAJ)
- Internet Archive / Open Library (buku public domain)
- Repositori universitas Indonesia (e-thesis, e-journal)

### 6.2 Kebijakan Konten
- Prioritaskan konten berbahasa Indonesia untuk Level 1–2.
- Level 3–4 boleh berbahasa Inggris (persiapan kuliah).
- Selalu cantumkan sumber dan lisensi.
- Tidak meng-host file berhak cipta tanpa izin.

### 6.3 Format Konten yang Didukung
- **PDF** — viewer `react-pdf` (prioritas saat ini)
- EPUB, video, artikel (roadmap)

---

## 7. ROADMAP PENGEMBANGAN

### Fase 1: Foundation (Sekarang)
- [v] Dokumen konteks & requirement
- [v] Setup VPS, Node.js, SQLite, Nginx
- [v] Auth JWT + Progress Tracker API
- [v] Reader PDF continuous scroll + catatan per halaman
- [v] User Dashboard (rekap progres & catatan)
- [v] Smart Search Engine (Fuse.js + sinonim)
- [v] Admin Backoffice (upload PDF + sampul ke R2)
- [ ] Kurasi 20+ konten per sub-bidang Manajemen

### Fase 2: Launch Manajemen
- [ ] Deploy website v1.0
- [ ] Uji coba dengan 5–10 siswa target
- [ ] Iterasi berdasarkan feedback

### Fase 3: Ekspansi
- [ ] Tambah bidang: Rekayasa & Teknologi
- [ ] Tambah bidang: Medis & Kesehatan
- [ ] Tambah bidang: Seni & Desain

### Fase 4: Maturation
- [ ] Semua 8+ bidang utama tersedia
- [ ] AI recommendation engine
- [ ] Komunitas diskusi per jalur
- [ ] Mobile app (PWA)

---

## 8. GLOSSARY & ISTILAH

| Istilah | Definisi |
|---------|----------|
| **Pohon Minat** | Struktur kategori berbasis jalur karier/jurusan |
| **Level 1 (Eksplorasi)** | Konten ringan yang memicu imajinasi |
| **Level 2 (Pengantar)** | Konten edukatif dasar, bahasa mudah |
| **Level 3 (Pendalaman)** | Konten akademis menengah, review paper |
| **Level 4 (Pra-Kuliah)** | Jurnal ilmiah, paper riset, skripsi |
| **Jembatan** | Konsep alur belajar dari ringan ke berat |
| **cover_url** | URL publik R2 sampul buku (prefix `covers/`) |
| **file_url** | URL publik R2 file PDF (prefix `pdfs/` atau path lama) |

---

## 9. CATATAN PENGEMBANGAN (Log Perubahan)

| Tanggal | Versi | Perubahan |
|---------|-------|-----------|
| 2026-08-30 | v1.0.0-alpha | Dokumen konteks awal. Fokus: Bidang Manajemen sebagai pilot. |
| 2026-09-07 | v1.0.1-alpha | Penyelarasan arsitektur Dynamic REST API dengan SQLite, mekanisme Progress Tracker. |
| 2026-09-13 | v1.0.2-alpha | Auth UI, database init, Reader PDF continuous scroll, catatan per halaman, Dashboard. |
| 2026-09-14 | v1.0.3-alpha | Smart Search Engine (Fuse.js + sinonim), halaman `/search`, Admin Backoffice upload multi-file ke R2 (prefix `covers/` & `pdfs/`), kartu buku berpusat pada `cover_url`, kolom `cover_url` ditambah ke SQLite. |

---

## 10. INSTRUKSI KHUSUS UNTUK AI ASSISTANT

Saat dokumen ini dibaca di sesi baru, AI harus:
1. Membaca seluruh dokumen ini sebagai konteks utama proyek.
2. Mengingat bahwa **Manajemen adalah bidang pertama** yang sedang dibangun.
3. Mengikuti struktur Pohon Minat dan sistem Level 1–4 secara ketat.
4. Mempertahankan autentikasi JWT dan pelacakan progres/catatan per pengguna melalui API; jangan kembalikan ke `localStorage`-only.
5. File PDF dan gambar **selalu ke Cloudflare R2**, bukan disimpan di disk VPS.
6. Selalu lindungi endpoint admin dengan middleware `auth` (JWT).
7. Fuse.js digunakan untuk search — jangan ganti ke endpoint SQL LIKE tanpa alasan kuat.

---

*Dokumen ini adalah Living Document. Update sesuai perkembangan proyek.*
*Dibuat: 30 Agustus 2026 — Diperbarui: 14 September 2026*
*Proyek: Perpustakaan Digital Kompas Karier & Minat*
