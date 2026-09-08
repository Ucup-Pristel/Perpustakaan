# DOKUMEN KONTEKS: PERPUSTAKAAN DIGITAL KOMPAS KARIER & MINAT
## UCUP-EDU-LIB v1.0.0-alpha

---

## 1. VISI & MISI

### Visi
Membangun perpustakaan digital yang berfungsi sebagai "kompas karier dan minat" bagi siswa SMA/sederajat, bukan sekadar perpustakaan biasa. Perpustakaan ini bertindak sebagai **jembatan** dari bacaan ringan menuju literatur akademis.

### Misi
1. Membantu siswa menemukan jalur karier dan jurusan kuliah melalui eksplorasi bacaan bertingkat.
2. Menyediakan konten yang dikurasi dengan sistem gradasi kesulitan (Level 1-4).
3. Menggantikan kategori subjek kaku dengan kategori berbasis "Pohon Minat & Jurusan".
4. Memberikan gambaran nyata tentang apa yang dipelajari di bangku kuliah sebelum siswa memilih jurusan.

---

## 2. PRINSIP DASAR

### 2.1 Kategorisasi Berbasis "Pohon Minat & Jurusan"
Alih-alih kategori kaku seperti "Fisika" atau "Sosiologi", gunakan kategori yang mencerminkan jalur karier atau jurusan kuliah. Setiap jalur memiliki sub-bidang yang terstruktur seperti pohon (tree structure).

### 2.2 Kurasi Konten Bertingkat (Gradasi Kesulitan)
Jurnal ilmiah murni sering terlalu berat untuk siswa SMA. Sistem tagging tingkat kesulitan:

| Level | Nama | Deskripsi | Contoh Konten |
|-------|------|-----------|---------------|
| **Level 1** | Eksplorasi | Memicu imajinasi dan rasa ingin tahu | Buku fiksi ilmiah, novel sejarah, majalah sains populer |
| **Level 2** | Pengantar | Membangun fondasi pemahaman | Buku teks non-fiksi, ensiklopedia, artikel open access ringan |
| **Level 3** | Pendalaman | Memperdalam pemahaman terstruktur | Review paper (makalah tinjauan), buku akademis menengah |
| **Level 4** | Pra-Kuliah | Gambaran nyata perkuliahan | Jurnal ilmiah asli, paper riset konferensi, tugas akhir/skripsi open access |

### 2.3 Prinsip Jembatan
Setiap jalur harus memiliki alur yang jelas dari Level 1 → Level 4. Siswa tidak boleh "loncat" tanpa panduan. UI/UX harus memvisualisasikan progres ini.

---

## 3. STRUKTUR POHON MINAT (MASTER TREE)

### 3.1 BIDANG MANAJEMEN (Priority: PERTAMA DIBANGUN)

```
MANAJEMEN
├── Manajemen Umum & Bisnis
│   ├── Level 1: Biografi pengusaha (Elon Musk, Rhenald Kasali), novel bisnis
│   ├── Level 2: Buku pengantar manajemen (Robbins), ensiklopedia bisnis
│   ├── Level 3: Review paper strategi bisnis, case study Harvard
│   └── Level 4: Jurnal Academy of Management, skripsi manajemen strategi
│
├── Manajemen Pemasaran (Marketing)
│   ├── Level 1: Buku konten kreator, novel tentang branding
│   ├── Level 2: Buku teks pemasaran (Kotler), artikel digital marketing
│   ├── Level 3: Review paper consumer behavior, case study Nike/Apple
│   └── Level 4: Jurnal Journal of Marketing, skripsi riset pasar
│
├── Manajemen Keuangan & Akuntansi
│   ├── Level 1: Buku "Rich Dad Poor Dad", biografi investor
│   ├── Level 2: Buku pengantar akuntansi, artikel investasi dasar
│   ├── Level 3: Review paper corporate finance, analisis laporan keuangan
│   └── Level 4: Jurnal The Accounting Review, skripsi audit/keuangan
│
├── Manajemen Sumber Daya Manusia (HRD)
│   ├── Level 1: Novel tentang workplace, biografi HR leader
│   ├── Level 2: Buku pengantar HR, artikel tentang organisasi
│   ├── Level 3: Review paper organizational behavior, case study Google
│   └── Level 4: Jurnal Human Resource Management, skripsi SDM
│
├── Manajemen Operasi & Supply Chain
│   ├── Level 1: Buku "The Goal" (Goldratt), dokumenter manufaktur
│   ├── Level 2: Buku pengantar operasi, artikel logistik
│   ├── Level 3: Review paper supply chain optimization, case study Toyota
│   └── Level 4: Jurnal Operations Research, skripsi supply chain
│
├── Manajemen Informatika & Sistem Informasi
│   ├── Level 1: Novel tentang startup tech, biografi Steve Jobs
│   ├── Level 2: Buku pengantar SI/TI, artikel trend teknologi bisnis
│   ├── Level 3: Review paper ERP/CRM, case study transformasi digital
│   └── Level 4: Jurnal MIS Quarterly, skripsi sistem informasi
│
├── Manajemen Pariwisata & Perhotelan
│   ├── Level 1: Novel travel, biografi hotelier terkenal
│   ├── Level 2: Buku pengantar pariwisata, artikel hospitality
│   ├── Level 3: Review paper destination marketing, case study Bali
│   └── Level 4: Jurnal Tourism Management, skripsi pariwisata
│
└── Kewirausahaan (Entrepreneurship)
    ├── Level 1: Buku "Zero to One", podcast startup
    ├── Level 2: Buku teks kewirausahaan, artikel business model canvas
    ├── Level 3: Review paper startup ecosystem, case study Gojek
    └── Level 4: Jurnal Entrepreneurship Theory & Practice, skripsi wirausaha
```

### 3.2 BIDANG LAIN (ROADMAP MASA DEPAN)
- Jalur Rekayasa & Teknologi
- Jalur Medis & Kesehatan
- Jalur Seni & Desain
- Jalur Hukum & Politik
- Jalur Sains & Matematika
- Jalur Sosial & Humaniora
- Jalur Pendidikan
- Jalur Pertanian & Lingkungan

---

## 4. SPESIFIKASI TEKNIS WEBSITE

### 4.1 Arsitektur Navigasi
- **Homepage:** Peta pohon minat interaktif (visual tree)
- **Halaman Jalur:** Detail sub-bidang dengan progress bar Level 1-4
- **Halaman Konten:** Viewer untuk PDF/ebook, embed untuk video, link untuk jurnal
- **Halaman Profil:** Riwayat bacaan, level yang sudah ditempuh, rekomendasi berikutnya

### 4.2 Fitur Utama
1. **Pohon Minat Interaktif** - Visualisasi tree yang bisa di-expand/collapse
2. **Sistem Leveling** - Tag warna untuk setiap level (Level 1=hijau, 2=kuning, 3=oranye, 4=merah)
3. **Progress Tracker** - Menandai konten yang sudah dibaca (Fase awal menggunakan localStorage di browser, Fase lanjut menggunakan integrasi akun pengguna ke database).
4. **Rekomendasi Pintar** - Setelah menyelesaikan Level 1, otomatis rekomendasikan Level 2
5. **Bookmark & Notes** - Siswa bisa menyimpan dan memberi catatan pada konten
6. **Search** - Pencarian berdasarkan judul, penulis, topik, atau level

### 4.3 Tech Stack (Sementara)
- Frontend: HTML5 + CSS3 + Vanilla JavaScript (tanpa framework berat)
- Backend: Node.js + Express (Menyajikan REST API)
- Database: SQLite (khusus untuk Metadata URL dan struktur hierarki)
- Storage: Cloudflare R2 (Khusus untuk file PDF, EPUB, dan media besar)
- Hosting: VPS Ubuntu dengan Nginx + PM2

### 4.4 Design Principles
- **Warm & Inviting:** Warna yang tidak seperti perpustakaan kaku, lebih seperti ruang eksplorasi
- **Visual Hierarchy:** Pohon minat sebagai elemen visual utama
- **Mobile-First:** Siswa mayoritas akses via HP
- **No Clutter:** Fokus pada konten, minim distraksi

---

## 5. KONTEN & KURASI

### 5.1 Sumber Konten (Legal & Open Access)
- Google Scholar (artikel open access)
- Directory of Open Access Journals (DOAJ)
- Internet Archive / Open Library (buku public domain)
- Repositori universitas Indonesia (e-thesis, e-journal)
- YouTube Edu (video pembelajaran berkualitas)
- Podcast edukasi bisnis

### 5.2 Kebijakan Konten
- Prioritaskan konten berbahasa Indonesia untuk Level 1-2
- Level 3-4 boleh berbahasa Inggris (persiapan kuliah)
- Selalu cantumkan sumber dan lisensi
- Tidak meng-host file berhak cipta tanpa izin (gunakan link/embed)

### 5.3 Format Konten yang Didukung
- PDF (ebook, jurnal, skripsi)
- EPUB (ebook)
---

## 6. ROADMAP PENGEMBANGAN

### Fase 1: Foundation (Sekarang)
- [v] Dokumen konteks & requirement
- [v] Setup VPS, Node.js, SQLite, dan Nginx
- [ ] Struktur pohon minat Manajemen (8 sub-bidang)
- [ ] UI/UX prototype (homepage + halaman jalur)
- [ ] Sistem tagging Level 1-4 dan Progress Tracker berbasis localStorage
- [ ] Kurasi 20+ konten per sub-bidang Manajemen

### Fase 2: Launch Manajemen
- [ ] Deploy website v1.0
- [ ] Uji coba dengan 5-10 siswa target
- [ ] Iterasi berdasarkan feedback

### Fase 3: Ekspansi
- [ ] Migrasi pelacakan progres dari localStorage ke tabel user_progress di database
- [ ] Tambah bidang: Rekayasa & Teknologi
- [ ] Tambah bidang: Medis & Kesehatan
- [ ] Tambah bidang: Seni & Desain
- [ ] Fitur: User account & progress sync antar perangkat

### Fase 4: Maturation
- [ ] Semua 8+ bidang utama tersedia
- [ ] Fitur: AI recommendation engine
- [ ] Fitur: Komunitas diskusi per jalur
- [ ] Mobile app (PWA)

---

## 7. GLOSSARY & ISTILAH

| Istilah | Definisi |
|---------|----------|
| **Pohon Minat** | Struktur kategori berbasis jalur karier/jurusan, bukan subjek akademis |
| **Level 1 (Eksplorasi)** | Konten ringan yang memicu imajinasi |
| **Level 2 (Pengantar)** | Konten edukatif dasar, bahasa mudah |
| **Level 3 (Pendalaman)** | Konten akademis menengah, review paper |
| **Level 4 (Pra-Kuliah)** | Konten perkuliahan nyata, jurnal & skripsi |
| **Jembatan** | Konsep alur belajar dari ringan ke berat |
| **Kurasi** | Proses seleksi dan pengorganisasian konten |

---

## 8. CATATAN PENGEMBANGAN (Log Perubahan)

| Tanggal | Versi | Perubahan |
|---------|-------|-----------|
| 2026-08-30 | v1.0.0-alpha | Dokumen konteks awal dibuat. Fokus: Bidang Manajemen sebagai pilot. |
| 2026-09-07 | v1.0.1-alpha	| Penyelarasan arsitektur Dynamic REST API dengan SQLite dan penyesuaian mekanisme Progress Tracker.

---

## 9. INSTRUKSI KHUSUS UNTUK AI ASSISTANT (CLINE)

Saat dokumen ini di-upload kembali di sesi baru, AI harus:
1. Membaca seluruh dokumen ini sebagai konteks utama proyek
2. Mengingat bahwa **Manajemen adalah bidang pertama** yang sedang dibangun
3. Mengikuti struktur Pohon Minat dan sistem Level 1-4 secara ketat
4. Tidak menyimpang ke kategori subjek tradisional
5. Selalu memprioritaskan konten open access dan legal
6. Memastikan state/progress tracking di Fase 1 dan 2 menggunakan API localStorage murni sebelum merancang integrasi database untuk user.

---

*Dokumen ini adalah Living Document. Update sesuai perkembangan proyek.*
*Dibuat: 30 Agustus 2026*
*Proyek: Perpustakaan Digital Kompas Karier & Minat*
