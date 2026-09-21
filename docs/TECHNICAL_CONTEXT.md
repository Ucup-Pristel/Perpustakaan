# DOKUMEN TEKNIS: INFRASTRUKTUR & ARSITEKTUR SISTEM
## ucup-edu-lib v1.0.0-alpha — Technical Specification

**Terakhir Diperbarui: Senin, 14 September 2026**

---

## 1. SPESIFIKASI SERVER (VPS)

| Resource | Spesifikasi |
|----------|-------------|
| **vCPU** | 2 Core |
| **RAM** | 2 GB |
| **Storage** | 20 GB SSD |
| **OS** | Ubuntu 24.04 LTS |
| **Lokasi** | Indonesia, SouthJKT-a (jkt01) |
| **Provider** | IDCloudHost |

### Catatan Kapasitas
- Dengan 2 GB RAM, hindari stack berat (no Docker swarm, no heavy DB).
- 20 GB storage cukup untuk OS + aplikasi + database metadata (bukan file media).
- File PDF/gambar/media disimpan di Cloudflare R2 (object storage eksternal).

---

## 2. ARSITEKTUR PENYIMPANAN (Storage Architecture)

### 2.1 Prinsip: "VPS Hanya Menyimpan URL"

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   User Browser  │◄────►│   VPS (Node.js)  │◄────►│ Cloudflare R2   │
│                 │      │                  │      │ (Object Storage)│
│  - React SPA    │      │  - Express API   │      │                 │
│  - PDF Viewer   │      │  - SQLite DB     │      │  pdfs/          │
│  - Search UI    │      │  - URL only      │      │  covers/        │
└─────────────────┘      └──────────────────┘      └─────────────────┘
         ▲                                               ▲
         └───────────── Direct Download ─────────────────┘
                    (Public URL dari R2_PUBLIC_URL)
```

### 2.2 Object Storage: Cloudflare R2

| Aspek | Detail |
|-------|--------|
| **Provider** | Cloudflare R2 |
| **Bucket** | `ucup-edu-lib` |
| **Akses** | Public read (file open access) |
| **Keuntungan** | 0 egress fee, S3-compatible API, gratis 10 GB/bulan |

### 2.3 Bucket Structure (R2) — Implementasi Saat Ini

```
ucup-edu-lib/
├── pdfs/          ← File PDF buku (upload via Admin Backoffice)
├── covers/        ← Sampul buku / cover image
└── Computer Engineering/   ← Path lama (legacy, buku seed awal)
```

Nama file diacak dengan format `<base>-<timestamp>-<4hex><ext>` untuk mencegah naming collision.

---

## 3. DATABASE (SQLite — VPS Local)

### 3.1 Pilihan Database

| Aspek | Keputusan |
|-------|-----------|
| **Engine** | SQLite (prototype → produksi awal) |
| **Alasan** | Zero-config, file-based, cukup untuk metadata, hemat RAM |
| **Migrasi** | Ke PostgreSQL saat concurrent user > 1.000 aktif |

Database runtime: `database/ucup-edu-lib.db`. `DB_FILENAME` di `.env` dapat menggantinya.

### 3.2 Skema Database (Aktual — 14 September 2026)

```sql
-- Bidang karier/jurusan
CREATE TABLE IF NOT EXISTS fields (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE,
    name        TEXT,
    description TEXT,
    icon        TEXT,
    color       TEXT,
    sort_order  INTEGER DEFAULT 0,
    is_active   BOOLEAN DEFAULT 1
);

-- Sub-bidang (pohon minat)
CREATE TABLE IF NOT EXISTS sub_fields (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    field_id    INTEGER,
    slug        TEXT UNIQUE,
    name        TEXT,
    description TEXT,
    parent_id   INTEGER,
    sort_order  INTEGER DEFAULT 0,
    FOREIGN KEY (field_id) REFERENCES fields(id)
);

-- Konten perpustakaan
CREATE TABLE IF NOT EXISTS contents (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_field_id     INTEGER,
    title            TEXT,
    author           TEXT,
    description      TEXT,
    level            INTEGER CHECK(level BETWEEN 1 AND 4),
    content_type     TEXT,        -- 'pdf', 'epub', 'video', 'article'
    source_url       TEXT,
    file_url         TEXT,        -- URL R2 file PDF (prefix pdfs/)
    cover_url        TEXT,        -- URL R2 gambar sampul (prefix covers/) ← BARU 14 Sep 2026
    cover_image_url  TEXT,        -- kolom lama, dipertahankan kompatibilitas
    tags             TEXT,
    language         TEXT,
    page_count       INTEGER,
    duration         INTEGER,
    difficulty_score INTEGER,
    is_featured      BOOLEAN DEFAULT 0,
    read_count       INTEGER DEFAULT 0,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sub_field_id) REFERENCES sub_fields(id)
);

-- Akun pengguna
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Progress bacaan per pengguna (halaman terakhir dibaca)
CREATE TABLE IF NOT EXISTS reading_progress (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    content_id INTEGER NOT NULL,
    last_page  INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_id),
    FOREIGN KEY (user_id)    REFERENCES users(id),
    FOREIGN KEY (content_id) REFERENCES contents(id)
);

-- Catatan per halaman per konten per pengguna
CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    content_id  INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    note_text   TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_id, page_number),
    FOREIGN KEY (user_id)    REFERENCES users(id),
    FOREIGN KEY (content_id) REFERENCES contents(id)
);

-- Progress lama (dipertahankan — dipakai ContentList & Dashboard summary)
CREATE TABLE IF NOT EXISTS user_progress (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    content_id     INTEGER,
    last_page_read INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'reading',
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_id),
    FOREIGN KEY (user_id)    REFERENCES users(id),
    FOREIGN KEY (content_id) REFERENCES contents(id)
);
```

### 3.3 Inisialisasi & Migrasi
- `database/init.js` menjalankan schema.sql secara idempoten, lalu menambah kolom-kolom baru (termasuk `file_url`, `reading_progress`, `notes`, `cover_url`) jika belum ada — aman dijalankan berulang.
- `backend/models/db.js` pakai Knex. Saat startup, memastikan tabel kritis tersedia.

---

## 4. FRAMEWORK & TECH STACK

### 4.1 Frontend

| Komponen | Pilihan | Versi |
|----------|---------|-------|
| **Framework** | React + Vite | 19 / 8 |
| **CSS** | Tailwind CSS | 4 |
| **Icons** | lucide-react | latest |
| **Routing** | react-router-dom | 7 |
| **PDF Viewer** | react-pdf | 11 |
| **State/Auth** | React Context + localStorage | — |

### 4.2 Backend

| Komponen | Pilihan | Versi |
|----------|---------|-------|
| **Runtime** | Node.js + Express | 22 / 4 |
| **DB Query** | Knex.js | 3 |
| **DB Driver** | sqlite3 | 5 |
| **Auth** | jsonwebtoken + bcrypt | 9 / 6 |
| **Upload** | multer (memoryStorage) | latest |
| **R2 Client** | @aws-sdk/client-s3 | latest |
| **Search** | fuse.js | latest |

### 4.3 Deployment

| Komponen | Pilihan |
|----------|---------|
| **Web Server** | Nginx (reverse proxy + static files) |
| **Process Manager** | PM2 |
| **SSL** | Let's Encrypt (certbot) |

---

## 5. STRUKTUR FILE PROYEK (Aktual)

```
ucup-edu-lib/
├── docs/
│   ├── PROJECT_CONTEXT.md
│   └── TECHNICAL_CONTEXT.md
│
├── database/
│   ├── schema.sql                # Skema lengkap (idempoten)
│   ├── init.js                   # Migrasi & seed startup
│   └── ucup-edu-lib.db           # SQLite runtime
│
├── backend/
│   ├── server.js                 # Entry point: health, /api/search, mount routes
│   ├── helpers/
│   │   └── queryParser.js        # Kamus sinonim pencarian (Fuse.js interceptor)
│   ├── middleware/
│   │   └── auth.js               # JWT verify → req.user.id
│   ├── models/
│   │   └── db.js                 # Knex SQLite instance
│   ├── routes/
│   │   ├── auth.js               # POST /register, POST /login
│   │   ├── activity.js           # reading-progress, notes, summary (JWT)
│   │   ├── admin.js              # upload multi-file, daftar & hapus konten (JWT)
│   │   ├── contents.js           # GET konten (public)
│   │   ├── fields.js             # GET fields
│   │   └── subfields.js          # GET sub-fields
│   └── utils/
│       └── r2Uploader.js         # S3Client R2, upload buffer → public URL
│
├── frontend/src/
│   ├── App.jsx                   # Router + AuthProvider
│   ├── index.css                 # Tailwind + .field component class
│   ├── components/
│   │   ├── Home.jsx              # Homepage
│   │   └── Navbar.jsx            # Search bar debounce + Enter → /search
│   ├── context/
│   │   └── AuthContext.jsx       # user, token, login, logout
│   └── pages/
│       ├── Login.jsx
│       ├── Register.jsx
│       ├── ContentList.jsx       # Daftar konten per bidang
│       ├── Reader.jsx            # PDF continuous scroll + progress + notes
│       ├── Dashboard.jsx         # Rekap terakhir dibaca + koleksi catatan
│       ├── SearchResults.jsx     # Grid kartu buku portrait dengan cover_url
│       └── AdminUpload.jsx       # Form upload PDF+cover, tabel konten
│
├── scripts/
│   └── seed-db.js
│
├── nginx/
│   └── ucup-edu-lib.conf
│
├── SESSION_LOG.md                # Log sesi pengembangan harian
└── package.json                  # Backend dependencies (root)
```

---

## 6. API ENDPOINTS (Implementasi Aktual)

Semua respons: `{ status, data, meta? }` atau `{ status, message }`.
Endpoint bertanda **[JWT]** butuh header `Authorization: Bearer <token>`.

### 6.0 Umum
```
GET  /api/health                        → Status API + timestamp
GET  /api/search?q=<kata>               → Fuzzy search (Fuse.js), public
```

### 6.1 Auth
```
POST /api/auth/register                 → email, password, full_name
POST /api/auth/login                    → email, password → JWT token
```

### 6.2 Fields & Sub-fields
```
GET  /api/fields                        → List semua bidang
GET  /api/fields/:slug                  → Detail bidang + sub-bidang
GET  /api/subfields                     → List semua sub-bidang
GET  /api/subfields/:slug               → Detail + konten
```

### 6.3 Contents (Public)
```
GET  /api/contents                      → List semua konten
GET  /api/contents/:id                  → Detail konten (termasuk file_url, cover_url)
```

### 6.4 Admin [JWT]
```
GET    /api/admin/contents              → Semua konten + thumbnail cover
POST   /api/admin/upload                → multipart: pdf (file), cover (file), metadata
DELETE /api/admin/contents/:id          → Hapus konten
```

### 6.5 Activity [JWT]
```
GET  /api/activity/reading-progress/:content_id   → last_page
POST /api/activity/reading-progress               → { content_id, last_page } — upsert
GET  /api/activity/notes/:content_id?page_number= → catatan halaman spesifik
POST /api/activity/notes                          → { content_id, page_number, note_text } — upsert
GET  /api/activity/summary                        → recent_reads + my_notes
```

---

## 7. SMART SEARCH ENGINE

### 7.1 Alur
1. Request `GET /api/search?q=<query>`
2. `queryParser.js` mencocokkan query ke kamus sinonim (case-insensitive):
   - `s1 tk` → `s1 teknik komputer`
   - `it` → `teknologi informasi`
   - `computer` → `komputer`
   - `programming` → `pemrograman`
   - `algorithm` → `algoritma`
   - `network` → `jaringan`
   - `database` → `basis data`
   - `machine learning` → `pembelajaran mesin`
3. Fuse.js mencari di kolom `title`, `author`, `description` (enriched dengan `sub_field_name` + `field_name`).
4. Search dijalankan dua kali: raw query + parsed query; hasil di-dedup by ID.

### 7.2 Konfigurasi Fuse.js
```js
{
  keys: ['title', 'author', 'description'],
  threshold: 0.4,
  ignoreLocation: true,
  distance: 100,
}
```

`ignoreLocation: true` — typo di posisi manapun dalam string tetap terdeteksi.

---

## 8. UPLOAD MULTI-FILE KE R2

### 8.1 Alur Upload
```
POST /api/admin/upload  (multipart/form-data)
  ├── pdf    → multer memoryStorage → uploadToR2(buffer, name, 'pdfs')   → file_url
  └── cover  → multer memoryStorage → uploadToR2(buffer, name, 'covers') → cover_url
                                                ↓
                                     INSERT INTO contents
```

### 8.2 Naming Convention
```
pdfs/<judul_bersih>-<Date.now()>-<4hex>.pdf
covers/<judul_bersih>-<Date.now()>-<4hex>.jpg
```

Karakter selain `a-zA-Z0-9_-. ` dihapus; spasi diganti `_`; nama dibatasi 60 karakter; suffix acak mencegah overwrite.

### 8.3 MIME Map (`r2Uploader.js`)
```
.pdf  → application/pdf
.jpg  → image/jpeg
.jpeg → image/jpeg
.png  → image/png
.webp → image/webp
.gif  → image/gif
```

---

## 9. READER PDF — ARSITEKTUR

### 9.1 Rendering
- `react-pdf` v11, PDF.js worker dari CDN/node_modules.
- `Array.from({length: numPages})` render semua halaman secara vertikal (continuous scroll).
- Lazy render: hanya halaman `activePage ± 2` yang render kanvas; sisanya placeholder.
- `ResizeObserver` mengukur wrapper → `containerWidth - 32px` → `<Page width={containerWidth}>`.

### 9.2 Progress Tracking
- `GET /api/activity/reading-progress/:id` saat PDF dimuat → scroll ke `last_page`.
- `IntersectionObserver` threshold 0.5 → update `activePage` saat halaman ≥ 50% terlihat.
- Debounce 600 ms → `POST /api/activity/reading-progress`.

### 9.3 Catatan per Halaman
- Setiap perubahan `activePage` → `GET /api/activity/notes/:id?page_number=N`.
- Tombol "Simpan Catatan" → `POST /api/activity/notes` (upsert).

---

## 10. KONFIGURASI PORT & ENVIRONMENT

### 10.1 Port
| Service | Port | Catatan |
|---------|------|---------|
| Backend Node.js | **3000** | Default `PORT=3000` di `.env` |
| Frontend Vite (dev) | 5173 | Proxy `/api` → `http://127.0.0.1:3000` |
| Hermes AI Proxy | 3101 | Jangan pakai port ini untuk backend |

Port 3000 ditetapkan sebagai standar backend untuk menghindari tabrakan dengan proxy AI di 3101.

### 10.2 Environment Variables (`.env`)
```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DB_CLIENT=sqlite3
DB_FILENAME=./database/ucup-edu-lib.db

# Cloudflare R2
R2_ACCOUNT_ID=<account_id>
R2_ACCESS_KEY_ID=<access_key>
R2_SECRET_ACCESS_KEY=<secret_key>
R2_BUCKET_NAME=ucup-edu-lib
R2_PUBLIC_URL=https://pub-<hash>.r2.dev

# Security
JWT_SECRET=<random_secret>

# Domain
DOMAIN=http://localhost:5173
VITE_API_URL=http://localhost:3000/api
```

---

## 11. SKALABILITAS & MIGRASI

### 11.1 Roadmap Skala

| Fase | Pengguna | Database | Estimasi Biaya/Bulan |
|------|----------|----------|----------------------|
| Prototype | 10–100 | SQLite | $5–10 |
| Growth | 100–1.000 | SQLite | $10–15 |
| Scale | 1.000–5.000 | PostgreSQL | $20–30 |
| Massive | 5.000–10.000 | PostgreSQL + Redis + LB | $50–70 |

### 11.2 Migrasi SQLite → PostgreSQL
Ganti satu baris di `.env`: `DB_CLIENT=pg` + tambah `DB_HOST`, `DB_DATABASE`, dll. Knex menangani sisanya. Total downtime < 5 menit jika fondasi sudah benar.

### 11.3 Prinsip Fondasi (Sudah Diterapkan)
- Semua query lewat Knex — tidak ada SQL SQLite-specific.
- Semua config di `.env` — tidak ada hardcode URL atau secret.
- Semua file media di R2 — VPS hanya menyimpan URL.
- Response format `{ status, data, meta }` konsisten di seluruh endpoint.

---

## 12. BACKUP STRATEGI

| Data | Lokasi | Frekuensi | Method |
|------|--------|-----------|--------|
| Database SQLite | VPS `database/` | Harian | `sqlite3 .backup` + rsync |
| File R2 | Cloudflare R2 | — | R2 lifecycle rules |
| Source Code | GitHub | Per commit | git push |
| Config Nginx | VPS `/etc/nginx/` | Mingguan | Manual copy |

---

## 13. CATATAN PENGEMBANGAN TEKNIS

| Tanggal | Versi | Perubahan |
|---------|-------|-----------|
| 2026-08-30 | v1.0.0-alpha | Dokumen teknis awal. VPS 2vCPU/2GB + R2. SQLite. Frontend Vanilla JS. |
| 2026-09-13 | v1.0.2-alpha | Frontend React/Vite, proxy `/api` → port 3000, AuthContext JWT, Reader PDF, progress & catatan. |
| 2026-09-14 | v1.0.3-alpha | Smart Search (Fuse.js + queryParser), Admin Backoffice (multer multi-file + R2 prefix pdfs/covers/), `cover_url` di SQLite, SearchResults grid portrait, port 3000 ditetapkan standar. |

---

## 14. INSTRUKSI AI ASSISTANT

Saat dokumen ini dibaca di sesi baru, AI harus:
1. Memahami arsitektur: VPS Node.js + SQLite REST API + Cloudflare R2.
2. **File PDF/media → R2**, bukan disk VPS.
3. **Database hanya menyimpan URL** (file_url, cover_url).
4. Progress dan catatan aktif via `/api/activity` dengan JWT — pertahankan kontrak ini.
5. Jangan sarankan stack berat (Docker, Kubernetes, heavy ORM) untuk VPS 2 GB.
6. Endpoint admin selalu dilindungi middleware `auth`.
7. Search: Fuse.js + `queryParser.js` — bukan SQL LIKE.
8. Port backend wajib 3000; jangan pakai 3101 (dipakai proxy Hermes AI).
9. Upload file: multer `memoryStorage` → buffer → `uploadToR2()` → URL disimpan ke SQLite.

---

*Dokumen ini adalah Living Document. Update sesuai perkembangan infrastruktur.*
*Dibuat: 30 Agustus 2026 — Diperbarui: 14 September 2026*
*Proyek: Perpustakaan Digital Kompas Karier & Minat*


