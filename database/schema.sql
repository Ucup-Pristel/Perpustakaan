-- ucup-edu-lib :: Skema Database
-- Gunakan IF NOT EXISTS agar aman dijalankan berulang (idempoten)

CREATE TABLE IF NOT EXISTS fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE,
    name TEXT,
    description TEXT,
    icon TEXT,
    color TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sub_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_id INTEGER,
    slug TEXT UNIQUE,
    name TEXT,
    description TEXT,
    parent_id INTEGER,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (field_id) REFERENCES fields(id)
);

CREATE TABLE IF NOT EXISTS contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_field_id INTEGER,
    title TEXT,
    author TEXT,
    description TEXT,
    level INTEGER CHECK(level BETWEEN 1 AND 4),
    content_type TEXT,
    source_url TEXT,
    file_url TEXT,
    cover_url TEXT,
    tags TEXT,
    language TEXT,
    page_count INTEGER,
    duration INTEGER,
    difficulty_score INTEGER,
    is_featured BOOLEAN DEFAULT 0,
    read_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sub_field_id) REFERENCES sub_fields(id)
);

CREATE TABLE IF NOT EXISTS content_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_field_id INTEGER,
    from_content_id INTEGER,
    to_content_id INTEGER,
    path_type TEXT,
    FOREIGN KEY (sub_field_id) REFERENCES sub_fields(id)
);

CREATE TABLE IF NOT EXISTS user_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    content_id INTEGER,
    last_page_read INTEGER DEFAULT 0,
    status TEXT DEFAULT 'reading',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (content_id) REFERENCES contents(id)
);

CREATE TABLE IF NOT EXISTS reading_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content_id INTEGER NOT NULL,
    last_page INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (content_id) REFERENCES contents(id)
);

CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content_id INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    note_text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_id, page_number),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (content_id) REFERENCES contents(id)
);
