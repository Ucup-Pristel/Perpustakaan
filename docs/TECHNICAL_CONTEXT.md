# DOKUMEN TEKNIS: INFRASTRUKTUR & ARSITEKTUR SISTEM
## ucup-edu-lib v1.0.0-alpha — Technical Specification

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
- Dengan 2GB RAM, hindari stack berat (no Docker swarm, no heavy DB)
- 20GB storage cukup untuk OS + aplikasi + database metadata (bukan file)
- File PDF/ebook/media disimpan di object storage eksternal (S3/R2)

---

## 2. ARSITEKTUR PENYIMPANAN (Storage Architecture)

### 2.1 Prinsip: "VPS Hanya Menyimpan Teks URL"
```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   User Browser  │◄────►│   VPS (2vCPU/2GB)│◄────►│ Cloudflare R2   │
│                 │      │                  │      │ (Object Storage)│
│  - HTML/CSS/JS  │      │  - App Server    │      │                 │
│  - Pohon Minat  │      │  - Database      │      │  - File PDF     │
│  - Progress UI  │      │  - Metadata Only │      │  - Ebook EPUB   │
│                 │      │  - URL Relatif   │      │  - Video/Audio  │
└─────────────────┘      └──────────────────┘      └─────────────────┘
         ▲                                               ▲
         │                                               │
         └───────────── Direct Download ─────────────────┘
                    (Signed URL / Public URL)
```

### 2.2 Object Storage: Cloudflare R2
| Aspek | Detail |
|-------|--------|
| **Provider** | Cloudflare R2 |
| **Use Case** | Menyimpan file PDF, EPUB, cover image, media |
| **Bucket Structure** | `ucup-edu-lib/` |
| **Akses** | Public read (untuk file open access) atau Signed URL |
| **Keuntungan** | 0 egress fee, compatible S3 API, gratis 10GB/bulan |
| **Alternatif** | Amazon S3, Backblaze B2, Wasabi |

### 2.3 Bucket Structure (R2)
```
ucup-edu-lib/
├── management/
│   ├── general-business/
│   │   ├── level1/
│   │   ├── level2/
│   │   ├── level3/
│   │   └── level4/
│   ├── marketing/
│   ├── finance-accounting/
│   ├── human-resources/
│   ├── operations-supplychain/
│   ├── information-systems/
│   ├── tourism-hospitality/
│   └── entrepreneurship/
├── engineering/
├── medical/
├── arts-design/
└── [future-fields]/
```

---

## 3. DATABASE (VPS Local)

### 3.1 Database Choice
| Aspek | Rekomendasi |
|-------|-------------|
| **Engine** | SQLite (untuk prototype) atau PostgreSQL (untuk production) |
| **Alasan SQLite** | Zero-config, file-based, cukup untuk metadata, hemat RAM |
| **Alasan PostgreSQL** | Skalabilitas, concurrent users, full-text search |
| **Decision** | **Mulai dengan SQLite**, migrasi ke PostgreSQL saat user > 100 |

### 3.2 Skema Database (Metadata Only)
```sql
-- Tabel: fields (Bidang/Jalur)
CREATE TABLE fields (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE,           -- e.g. "management"
    name TEXT,                  -- e.g. "Manajemen"
    description TEXT,
    icon TEXT,                  -- emoji atau icon path
    color TEXT,                 -- hex color
    sort_order INTEGER,
    is_active BOOLEAN DEFAULT 1
);

-- Tabel: sub_fields (Sub-bidang)
CREATE TABLE sub_fields (
    id INTEGER PRIMARY KEY,
    field_id INTEGER,
    slug TEXT UNIQUE,           -- e.g. "marketing"
    name TEXT,                -- e.g. "Manajemen Pemasaran"
    description TEXT,
    parent_id INTEGER,        -- untuk nested sub-bidang
    sort_order INTEGER,
    FOREIGN KEY (field_id) REFERENCES fields(id)
);

-- Tabel: contents (Konten Perpustakaan)
CREATE TABLE contents (
    id INTEGER PRIMARY KEY,
    sub_field_id INTEGER,
    title TEXT,
    author TEXT,
    description TEXT,
    level INTEGER CHECK(level BETWEEN 1 AND 4),
    content_type TEXT,        -- 'pdf', 'epub', 'video', 'article', 'podcast'
    source_url TEXT,          -- URL asli (Google Scholar, DOAJ, etc.)
    file_url TEXT,            -- URL ke R2 (jika file di-host)
    cover_image_url TEXT,     -- URL cover/cover image
    tags TEXT,                -- JSON array of tags
    language TEXT,            -- 'id', 'en'
    page_count INTEGER,       -- untuk buku
    duration INTEGER,         -- untuk video/audio (detik)
    difficulty_score INTEGER, -- 1-10 untuk granular
    is_featured BOOLEAN DEFAULT 0,
    read_count INTEGER DEFAULT 0,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    FOREIGN KEY (sub_field_id) REFERENCES sub_fields(id)
);

-- Tabel: content_paths (Jalur Pembelajaran)
CREATE TABLE content_paths (
    id INTEGER PRIMARY KEY,
    sub_field_id INTEGER,
    from_content_id INTEGER,
    to_content_id INTEGER,
    path_type TEXT,           -- 'sequential', 'branch', 'prerequisite'
    FOREIGN KEY (sub_field_id) REFERENCES sub_fields(id)
);

-- Tabel: user_progress (Disiapkan Untuk Fase 3 saja)
CREATE TABLE user_progress (
    id INTEGER PRIMARY KEY,
    user_id TEXT,
    content_id INTEGER,
    status TEXT,              -- 'not_started', 'reading', 'completed'
    progress_percent INTEGER,
    completed_at TIMESTAMP,
    FOREIGN KEY (content_id) REFERENCES contents(id)
);
```

### 3.3 Contoh Data (Manajemen Pemasaran)
```sql
-- Insert Field
INSERT INTO fields (slug, name, description, color) 
VALUES ('management', 'Manajemen', 'Jalur karier dalam dunia bisnis dan manajemen', '#2563EB');

-- Insert Sub-field
INSERT INTO sub_fields (field_id, slug, name, description, sort_order)
VALUES (1, 'marketing', 'Manajemen Pemasaran', 'Strategi, riset pasar, branding, dan digital marketing', 2);

-- Insert Content Level 1
INSERT INTO contents (sub_field_id, title, author, description, level, content_type, source_url, file_url, tags, language)
VALUES (1, 'Konten Kreator: Rahasia Sukses di Era Digital', 'Rhenald Kasali', 
        'Buku ringan tentang dunia digital marketing dan konten kreator', 
        1, 'pdf', '[https://bukugratis.com/konten-kreator](https://bukugratis.com/konten-kreator)', '/management/marketing/level1/konten-kreator.pdf',
        '["marketing", "digital", "kreator"]', 'id');

-- Insert Content Level 4
INSERT INTO contents (sub_field_id, title, author, description, level, content_type, source_url, file_url, tags, language)
VALUES (1, 'Consumer Behavior in Digital Age', 'Journal of Marketing', 
        'Jurnal ilmiah tentang perilaku konsumen di era digital', 
        4, 'article', '[https://doi.org/10.1509/jm.XX.XX](https://doi.org/10.1509/jm.XX.XX)', NULL,
        '["consumer-behavior", "digital", "journal"]', 'en');
```

---

## 4. FRAMEWORK & TECH STACK

### 4.1 Frontend
| Komponen | Pilihan | Alasan |
|----------|---------|--------|
| **Framework** | Vanilla HTML5 + CSS3 + JS | Ringan, no build step, hemat RAM VPS |
| **CSS** | Tailwind CSS (CDN) | Utility-first, cepat styling, no build |
| **Icons** | Lucide (CDN) atau Heroicons | SVG, ringan |
| **Charts/Tree** | D3.js (minimal) atau CSS Tree | Visualisasi pohon minat |
| **State** | Vanilla JS (localStorage) | Cukup untuk Fase 1 & 2 progress tracking |

### 4.2 Backend (Jika Perlu)
| Komponen | Pilihan | Alasan |
|----------|---------|--------|
| **Runtime** | Node.js + Express | Ringan, JavaScript universal |
| **Alternative** | Python + Flask/FastAPI | Jika lebih nyaman Python |
| **Alternative** | PHP + SQLite | Paling hemat resource |
| **API** | REST JSON | Sederhana, universal |

### 4.3 Deployment
| Komponen | Pilihan |
|----------|---------|
| **Web Server** | Nginx (reverse proxy + static file) |
| **Process Manager** | PM2 (Node.js) atau systemd |
| **SSL** | Let's Encrypt (certbot) |
| **Domain** | [Isi domain Anda] |

---

## 5. STRUKTUR FILE PROYEK

```
ucup-edu-lib/
├── docs/                           # Dokumentasi
│   ├── PROJECT_CONTEXT.md          # Dokumen konteks bisnis
│   ├── TECHNICAL_CONTEXT.md        # Dokumen teknis (ini)
│   └── CHANGELOG.md                # Log perubahan
│
├── database/                       # Database & seed data
│   ├── schema.sql                  # Skema database
│   ├── seed_management.sql         # Data awal bidang Manajemen
│   └── ucup-edu-lib.db             # File SQLite (production)
│
├── backend/                        # API Server (jika pakai backend)
│   ├── server.js                   # Entry point Express
│   ├── routes/
│   │   ├── admin.js                # API: endpoint terproteksi JWT untuk kelola konten
│   │   ├── fields.js               # API: daftar bidang
│   │   ├── subfields.js            # API: daftar sub-bidang
│   │   ├── contents.js             # API: daftar konten
│   │   └── progress.js             # API: progress user
│   ├── models/
│   │   └── db.js                   # Koneksi database
│   └── package.json
│
├── frontend/                       # Static Website
│   ├── index.html                  # Homepage: Pohon Minat
│   ├── jalur/                      # Halaman per jalur
│   │   ├── management/
│   │   │   ├── index.html          # Overview Manajemen
│   │   │   ├── marketing.html      # Detail Pemasaran
│   │   │   ├── finance.html        # Detail Keuangan
│   │   │   └── ...
│   │   └── [future-fields]/
│   ├── konten/                     # Halaman detail konten
│   │   └── [content-slug].html
│   ├── css/
│   │   ├── main.css                # Styles utama
│   │   ├── tree.css                # Styles pohon minat
│   │   └── levels.css              # Styles level tagging
│   ├── js/
│   │   ├── main.js                 # Logic utama
│   │   ├── tree.js                 # Render pohon minat
│   │   ├── levels.js               # Logic level & progress
│   │   └── search.js               # Fitur pencarian
│   └── assets/
│       ├── images/                 # Logo, icon, banner
│       └── fonts/                  # Font lokal (jika perlu)
│
├── scripts/                        # Automation scripts
│   ├── seed-db.js                  # Script populate database
│   ├── deploy.sh                   # Script deployment
│   └── backup.sh                   # Script backup database
│
├── nginx/                          # Config server
│   └── ucup-edu-lib.conf           # Virtual host Nginx
│
└── README.md                       # Quick start guide
```

---

## 6. API ENDPOINTS (Draft)

### 6.1 Fields (Bidang)
```
GET    /api/fields              → List semua bidang
GET    /api/fields/:slug        → Detail satu bidang + sub-bidang
```

### 6.2 Sub-fields
```
GET    /api/subfields           → List semua sub-bidang
GET    /api/subfields/:slug     → Detail sub-bidang + konten
GET    /api/subfields/:slug/contents?level=1,2,3,4 → Filter konten per level
```

### 6.3 Contents (Public - Read)
```
GET    /api/contents            → List semua konten (with pagination)
GET    /api/contents/:id        → Detail konten
GET    /api/contents/search?q=marketing&level=2 → Search
```
### 6.4 Admin Contents (Protected by JWT)
```
POST   /api/contents            → Tambah buku/jurnal baru
PUT    /api/contents/:id        → Update data konten
DELETE /api/contents/:id        → Hapus konten
```

### 6.5 Progress
**Catatan Fase 1 & 2:** Progress murni disimpan di `localStorage` browser. API `/api/progress` di bawah ini baru dibangun di Fase 3.
```http
POST   /api/progress            → Update progress bacaan
GET    /api/progress/:user_id   → Riwayat progress user
```

---

## 7. ENVIRONMENT VARIABLES

Buat file `.env` di root backend:

```bash
# Server
PORT=3000
NODE_ENV=production

# Database
DB_PATH=./database/ucup-edu-lib.db

# Cloudflare R2 (Object Storage)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=ucup-edu-lib
R2_PUBLIC_URL=https://pub-[hash].r2.dev

# Security
JWT_SECRET=your_random_secret_key
SESSION_SECRET=another_random_secret

# Domain
DOMAIN=[Belum ada domain — beli setelah website jadi]
```

---

## 8. CHECKLIST DEPLOYMENT

### 8.1 VPS Setup
- [v] Install Ubuntu 24.04 LTS
- [v] Update & upgrade: `apt update && apt upgrade`
- [v] Install Nginx: `apt install nginx`
- [v] Install Node.js 20+: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -`
- [v] Install PM2: `npm install -g pm2`
- [v] Install Certbot: `apt install certbot python3-certbot-nginx`
- [v] Setup firewall (UFW): `ufw allow 'Nginx Full'`

### 8.2 R2 Setup
- [v] Buat akun Cloudflare
- [v] Aktifkan R2 di dashboard
- [v] Buat bucket `ucup-edu-lib`
- [v] Generate API token (S3-compatible)
- [v] Upload file PDF ke bucket
- [v] Setup public access atau signed URL

### 8.3 Aplikasi Setup
- [ ] Clone repo ke VPS
- [ ] Install dependencies: `npm install`
- [ ] Buat file `.env`
- [ ] Jalankan seed database: `node scripts/seed-db.js`
- [ ] Test API: `node backend/server.js`
- [ ] Setup PM2: `pm2 start backend/server.js --name ucup-edu-lib`
- [ ] Setup Nginx reverse proxy
- [ ] Setup SSL dengan Certbot
- [ ] Test akses dari browser

---

## 9. OPTIMASI VPS (2vCPU/2GB)

### 9.1 Nginx Config (ucup-edu-lib.conf)
```nginx
server {
    listen 80;
    server_name perpustakaan-karier.id www.perpustakaan-karier.id;

    # Redirect ke HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name perpustakaan-karier.id;

    ssl_certificate /etc/letsencrypt/live/perpustakaan-karier.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/perpustakaan-karier.id/privkey.pem;

    # Static files (frontend)
    location / {
        root /var/www/ucup-edu-lib/frontend;
        try_files $uri $uri/ /index.html;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # API (backend)
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # File dari R2 (proxy untuk signed URL)
    location /files/ {
        proxy_pass https://pub-[hash].r2.dev/;
        proxy_set_header Host pub-[hash].r2.dev;
    }

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
```

### 9.2 PM2 Config (ecosystem.config.js)
```javascript
module.exports = {
  apps: [{
    name: 'ucup-edu-lib',
    script: './backend/server.js',
    instances: 1,           // Hanya 1 instance karena 2GB RAM
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    max_memory_restart: '512M',  // Restart jika memori > 512MB
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    time: true
  }]
};
```

### 9.3 Swap Memory (Jika RAM penuh)
```bash
# Buat 2GB swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
# Tambahkan ke /etc/fstab untuk persistent
```

---

## 10. SKALABILITAS & PERSIAPAN MASA DEPAN

> **Prinsip:** Migrasi dari 10 siswa → 10.000 siswa harus seamless. Persiapan fondasi SEKARANG menentukan apakah migrasi nanti menyakitkan atau mudah.

### 10.1 Roadmap Skalabilitas

| Fase | Jumlah Siswa | VPS | Database | Stack | Estimasi Biaya/Bulan |
|------|-------------|-----|----------|-------|---------------------|
| **Fase 1: Prototype** | 10–100 | 2vCPU / 2GB | SQLite | PM2 + Nginx + Vanilla JS | **$5–10** |
| **Fase 2: Growth** | 100–1.000 | 2vCPU / 4GB | SQLite | PM2 + Nginx + Cache | **$10–15** |
| **Fase 3: Scale** | 1.000–5.000 | 4vCPU / 8GB | PostgreSQL | PM2 + Nginx + PostgreSQL | **$20–30** |
| **Fase 4: Massive** | 5.000–10.000 | 2× VPS 4GB + LB | PostgreSQL + Redis | Load Balancer + 2 App Server | **$50–70** |
| **Fase 5: Enterprise** | 10.000+ | 3× VPS + CDN | Managed DB + Redis | Full Cloud Architecture | **$100–200** |

### 10.2 Mengapa SQLite Cukup untuk Fase 1–2

SQLite sangat cepat untuk **read-heavy workload** (perpustakaan = 90% read, 10% write):
- Bisa handle **ribuan read request/detik**
- Zero overhead (tidak butuh service terpisah)
- Tidak butuh RAM tambahan

**Bottleneck pertama bukan database — tapi bandwidth R2** (file PDF yang diunduh siswa).

### 10.3 Kapan Wajib Migrasi ke PostgreSQL

| Kondisi | Action |
|---------|--------|
| **> 1.000 user aktif bersamaan** | SQLite mulai lock saat write progress. Migrasi ke PostgreSQL. |
| **Fitur user account & progress sync** | Butuh concurrent write. PostgreSQL wajib. |
| **Tim developer > 1 orang** | PostgreSQL lebih mudah di-manage dan di-backup. |
| **Butuh full-text search** | PostgreSQL + `pg_trgm` atau `tsvector` lebih powerful. |

### 10.4 Persiapan Fondasi SEKARANG (Agar Migrasi Tidak Menyakitkan)

#### A. Gunakan Abstraksi Database (ORM/Query Builder)

Gunakan **Knex.js** atau **Sequelize** sejak sekarang. Ganti client = ganti 1 baris config:

```javascript
const knex = require('knex')({
  client: 'sqlite3',        // SEKARANG
  // client: 'pg',          // NANTI — tinggal uncomment
  connection: {
    filename: './database/ucup-edu-lib.db'
    // host: 'localhost',   // NANTI untuk PostgreSQL
    // database: 'ucup_edu',
    // user: 'admin',
    // password: 'secret'
  },
  useNullAsDefault: true    // Penting untuk kompatibilitas SQLite → PostgreSQL
});
```

**Jangan tulis query SQLite-specific** seperti `PRAGMA`, `strftime()`, atau `AUTOINCREMENT`.

#### B. Pisahkan Config dari Kode (`.env`)

Semua yang bisa berubah saat migrasi harus di `.env`:

```bash
# Database — SEKARANG
DB_CLIENT=sqlite3
DB_FILENAME=./database/ucup-edu-lib.db

# Database — NANTI (tinggal ganti)
# DB_CLIENT=pg
# DB_HOST=localhost
# DB_PORT=5432
# DB_DATABASE=ucup_edu
# DB_USER=admin
# DB_PASSWORD=secret

# Object Storage — SEKARANG (R2)
R2_PUBLIC_URL=https://pub-xxx.r2.dev

# Object Storage — NANTI (S3 atau R2 lain)
# R2_PUBLIC_URL=https://ucup-edu-lib.s3.ap-southeast-1.amazonaws.com
```

#### C. Jangan Simpan State di Memory

❌ **JANGAN:**
```javascript
// Hilang saat server restart
const activeUsers = {};
const sessionCache = new Map();
```

✅ **LAKUKAN:**
```javascript
// Persisten di database
await db('user_sessions').insert({ user_id, token, expires_at });
```

#### D. API Response Format Konsisten

Gunakan format JSON yang sama sejak sekarang — jangan ganti-ganti nanti:

```json
{
  "status": "success",
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "total_pages": 8
  }
}
```

#### E. R2 URL Harus Configurable (Frontend / Backend Synthesis)

Jangan pernah hardcode URL Cloudflare R2 di database. Gabungkan dengan variabel lingkungan hanya saat API mengirim data:

```javascript
// ❌ JANGAN simpan URL lengkap di database

// ✅ LAKUKAN
const fullFileUrl = `${process.env.R2_PUBLIC_URL}${dbRecord.file_url}`;
```

### 10.5 Migrasi SQLite → PostgreSQL (Step-by-Step)

Saat tiba waktunya (Fase 3), lakukan ini:

1. **Export SQLite:**
   ```bash
   sqlite3 ucup-edu-lib.db .dump > dump.sql
   ```

2. **Convert syntax** (auto dengan tool):
   ```bash
   npm install -g sqlite-to-postgres
   sqlite-to-postgres dump.sql > dump-pg.sql
   ```

3. **Import ke PostgreSQL:**
   ```bash
   psql -U admin -d ucup_edu < dump-pg.sql
   ```

4. **Ganti `.env`:**
   ```bash
   DB_CLIENT=pg
   DB_HOST=localhost
   DB_DATABASE=ucup_edu
   ```

5. **Restart PM2:**
   ```bash
   pm2 restart ucup-edu-lib
   ```

**Total downtime: < 5 menit** — kalau fondasi sudah benar.

### 10.6 Migrasi 1 VPS → Load Balancer (Fase 4)

```
SEKARANG (1 VPS):
┌─────────────────┐
│   VPS 2GB RAM   │
│  Nginx + App    │
│  SQLite         │
└─────────────────┘

NANTI (2 VPS + LB):
┌──────────┐     ┌─────────────┐     ┌─────────────┐
│ Cloudflare│────►│  VPS #1     │     │  VPS #2     │
│  LB / CDN │     │  Nginx + App│     │  Nginx + App│
└──────────┘     └─────────────┘     └─────────────┘
                        │                    │
                        └────────┬───────────┘
                                 ▼
                        ┌─────────────────┐
                        │  VPS #3 (4GB)   │
                        │  PostgreSQL     │
                        │  + Redis        │
                        └─────────────────┘
```

**Yang perlu diubah:**
- Nginx config: tambahkan `upstream` ke 2 app server
- `.env`: `DB_HOST` ubah ke IP VPS database
- Session: pakai Redis (shared antar VPS) atau JWT (stateless)

---

## 11. BACKUP STRATEGI

| Data | Lokasi | Backup Frequency | Method |
|------|--------|------------------|--------|
| Database (SQLite) | VPS `/database/` | Harian | `sqlite3 .backup` + rsync |
| File R2 | Cloudflare R2 | - | R2 lifecycle rules |
| Source Code | GitHub/GitLab | Per commit | Git push |
| Config | VPS `/etc/nginx/` | Mingguan | Manual copy |

---

## 12. CATATAN PENGEMBANGAN TEKNIS

| Tanggal | Versi | Perubahan |
|---------|-------|-----------|
| 2026-08-30 | v1.0.0-alpha | Dokumen teknis awal. Arsitektur: VPS 2vCPU/2GB + R2. Database: SQLite. Frontend: Vanilla JS. |

---

## 13. INSTRUKSI AI ASSISTANT (CLINE)

Saat dokumen ini di-upload kembali di sesi baru, AI harus:
1. Membaca dan memahami arsitektur sistem (VPS Node.js + SQLite REST API + Cloudflare R2).
2. Mengingat bahwa **file PDF/media disimpan di R2, bukan VPS**
3. Mengingat bahwa **database hanya menyimpan metadata & URL relatif**
4. Tidak membuat fungsionalitas Backend untuk Progress Tracking sampai Fase 3 tiba (gunakan LocalStorage di Frontend).
5. Tidak menyarankan stack berat (Docker, Kubernetes, heavy DB) karena keterbatasan VPS 2GB.
6. Selalu merancang endpoint POST/PUT untuk admin yang dilindungi oleh JWT.

---

*Dokumen ini adalah Living Document. Update sesuai perkembangan infrastruktur.*
*Dibuat: 30 Agustus 2026*
*Proyek: Perpustakaan Digital Kompas Karier & Minat*
