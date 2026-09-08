-- ucup-edu-lib :: Seed Data Bidang Manajemen
-- Sumber: docs/TECHNICAL_CONTEXT.md § 3.3
-- Catatan: URL di dokumen tertulis dalam format markdown auto-link
--   `[https://...](https://...)` — di sini ditulis sebagai URL polos
--   agar valid saat dieksekusi SQLite.

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
        1, 'pdf', 'https://bukugratis.com/konten-kreator', '/management/marketing/level1/konten-kreator.pdf',
        '["marketing", "digital", "kreator"]', 'id');

-- Insert Content Level 4
INSERT INTO contents (sub_field_id, title, author, description, level, content_type, source_url, file_url, tags, language)
VALUES (1, 'Consumer Behavior in Digital Age', 'Journal of Marketing',
        'Jurnal ilmiah tentang perilaku konsumen di era digital',
        4, 'article', 'https://doi.org/10.1509/jm.XX.XX', NULL,
        '["consumer-behavior", "digital", "journal"]', 'en');