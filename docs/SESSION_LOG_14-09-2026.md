JUDUL: Timestamps : Senin, 14 September 2026

pekerjaan :
- Memverifikasi konfigurasi kredensial keamanan di file '.env' (Cloudflare R2, JWT, VITE_API_URL).
- Menetapkan aturan alur kolaborasi Git (Branching & Pull Request) untuk pengerjaan UI di masa depan.
- Membangun fitur Smart Search Engine menggunakan 'fuse.js' pada backend dan integrasi dropdown frontend dengan efek debounce.
- Memperbarui sistem pencarian agar mendukung navigasi tombol 'Enter' menuju halaman hasil pencarian (/search).
- Membangun fondasi Admin Backoffice dan API Upload menggunakan 'multer' dan S3 Client.
- Memodifikasi sistem Upload agar mendukung pengiriman ganda (Dokumen PDF dan Gambar Sampul) ke Cloudflare R2 secara paralel.
- Merombak UI Kartu Buku agar berpusat pada visual sampul ('cover_url') dan menyembunyikan elemen teks deskripsi tanpa merusak indeks pencarian.

masalah :
- Potensi Tabrakan Port (Port Collision): Proksi AI berjalan di port 3101. Solusi: Backend Node.js ditetapkan di port 3000 untuk mencegah error EADDRINUSE saat booting.
- AI Agent Crash/Disconnect: Proksi Headroom AI (profil default) mati. Solusi: Mengeksekusi 'headroom install start --profile default' melalui terminal untuk mengembalikan koneksi proksi tanpa merusak konfigurasi.
- Search Bar Tidak Merespons Enter: Dropdown hasil muncul, tapi form tidak bisa di-submit. Solusi: Menambahkan event listener 'onKeyDown' dan hook 'useNavigate' untuk melakukan routing ke halaman hasil.
- Risiko Overwrite File (Naming Collision): R2 akan menimpa file jika nama sampul/PDF sama. Solusi: Memanipulasi nama file dengan menyisipkan Date.now() / UUID dan memisahkannya ke dalam path prefix 'covers/' dan 'pdfs/'.

bug :
- Bug pada interaksi penyimpanan di Panel Catatan PDF (Diparkir untuk fokus ke MVP).
- Typo-tolerance tingkat lanjut di Fuse.js (contoh: "computer" vs "komputer") belum terdeteksi secara optimal meski threshold sudah dilonggarkan (Diparkir).
