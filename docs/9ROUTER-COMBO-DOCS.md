🚀 Dokumentasi Konfigurasi Combo 9router - E-Book Library Project

Dokumentasi ini mencakup seluruh strategi perutean AI (routing strategy), pemilihan model, dan fungsi spesifik untuk pengembangan proyek perpustakaan e-book menggunakan 9router dan ekstensi Cline (diintegrasikan dengan skill Ponytail).
1. Super-Coder

    Strategi: Fallback (Mencoba model dari atas ke bawah secara berurutan jika terjadi rate limit atau error).

    Fungsi Utama: Digunakan sehari-hari di Cline untuk menulis kode frontend, backend, dan logika inti aplikasi.

    Daftar Model (Urutan Optimal):

        cx/gpt-5.6-sol (OpenAI Codex - Model logika backend utama)

        oc/nemotron-3-ultra-free / atau model Claude/Sonnet terbaik pilihanmu di urutan atas. (Catatan: Pastikan isi dibatasi 4-6 model terbaik saja, bersihkan model sisa nomor 7-12 agar tidak terjadi delay).

        Model-model cadangan kelas berat (seperti varian Claude Opus/Sonnet dan GLM/Kimi).

        Paling Bawah: Model gratisan sebagai pengaman terakhir agar tidak pernah crash.

2. Judge-Architect

    Strategi: Fusion (Semua model panel menganalisis secara paralel, lalu satu model Judge menyimpulkan jawaban terbaik).

    Fungsi Utama: Digunakan saat pertama kali merancang skema database relasional, arsitektur sistem, dan logika kritis (seperti perhitungan poin/diskon).

    Panel Models (Pemberi Ide):

        kr/claude-opus-5-agentic

        cx/gpt-6-astra

        gemini/gemini-3.1-pro-preview

    Judge Model (Pengambil Keputusan Akhir):

        kr/claude-opus-5-thinking-agentic

3. Infinite-Loop

    Strategi: Round Robin (Memutar beban tugas secara bergiliran antar model agar kuota dan rate limit tidak cepat habis).

    Fungsi Utama: Dipakai untuk debugging masif, refactoring kode bersama Ponytail, atau pembersihan file dalam jumlah banyak.

    Daftar Model:

        openrouter/nvidia/nemotron-3-super-120b-a12b:free

        oc/nemo-v2.5-free

        kimi/kimi-k3

        ag/gemini-3.8-flash-medium

4. UI-Frontend-Master

    Strategi: Fallback

    Fungsi Utama: Spesialis pembuatan tampilan antarmuka (UI/UX), styling Tailwind/CSS, dan struktur komponen web e-book.

    Daftar Model:

        kr/claude-sonnet-4.5

        gh/claude-sonnet-4.6

        ag/gemini-3.7-flash-high

5. Docs-&-Boilerplate

    Strategi: Round Robin

    Fungsi Utama: Membuat dokumentasi proyek, file README.md untuk GitHub, kerangka konfigurasi (boilerplate), dan file teks pendukung.

    Daftar Model:

        kimi/kimi-for-coding

        oc/mimo-v2.5-free

        openrouter/cohere/north-mini-code:free

6. Deep-Debugger

    Strategi: Fusion

    Fungsi Utama: Membedah bug tingkat tinggi yang rumit atau masalah asinkronus yang sulit dipecahkan oleh single model.

    Panel Models:

        kr/claude-opus-5-thinking

        cx/gpt-5.6-sol-review

        gh/claude-opus-4.7

    Judge Model:

        kr/claude-opus-5-thinking-agentic
