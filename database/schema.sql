-- ucup-edu-lib :: Skema Database (Metadata Only)
-- Sumber: docs/TECHNICAL_CONTEXT.md § 3.2
-- Catatan: hindari sintaks SQLite-specific (AUTOINCREMENT, PRAGMA, strftime)
-- agar migrasi ke PostgreSQL di Fase 3 mulus (lihat § 10.4.A).

-- Tabel: fields (Bidang/Jalur)
CREATE TABLE fields (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE,
    name TEXT,
    description TEXT,
    icon TEXT,
    color TEXT,
    sort_order INTEGER,
    is_active BOOLEAN DEFAULT 1
);

-- Tabel: sub_fields (Sub-bidang)
CREATE TABLE sub_fields (
    id INTEGER PRIMARY KEY,
    field_id INTEGER,
    slug TEXT UNIQUE,
    name TEXT,
    description TEXT,
    parent_id INTEGER,
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
    content_type TEXT,
    source_url TEXT,
    file_url TEXT,
    cover_image_url TEXT,
    tags TEXT,
    language TEXT,
    page_count INTEGER,
    duration INTEGER,
    difficulty_score INTEGER,
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
    path_type TEXT,
    FOREIGN KEY (sub_field_id) REFERENCES sub_fields(id)
);

-- Tabel: user_progress (Disiapkan Untuk Fase 3 saja)
CREATE TABLE user_progress (
    id INTEGER PRIMARY KEY,
    user_id TEXT,
    content_id INTEGER,
    status TEXT,
    progress_percent INTEGER,
    completed_at TIMESTAMP,
    FOREIGN KEY (content_id) REFERENCES contents(id)
);