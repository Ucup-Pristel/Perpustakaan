-- ucup-edu-lib :: Schema Reference
-- Dieksekusi via Knex createTableIfNotExists di models/db.js (bukan file ini langsung)

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT    NOT NULL UNIQUE,
  password_hash TEXT   NOT NULL,
  full_name    TEXT    NOT NULL,
  role         TEXT    NOT NULL DEFAULT 'member',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_progress (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  content_id     INTEGER NOT NULL,
  last_page_read INTEGER NOT NULL DEFAULT 0,
  status         TEXT    NOT NULL DEFAULT 'reading',  -- reading | finished
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, content_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  content_id  INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  note_text   TEXT    NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

