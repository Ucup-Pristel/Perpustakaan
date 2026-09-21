9Router Combo Save State - 16 September 2026

1. Super-Coder (Mode: Fallback - try in order)
Mesin logika utama untuk backend dan arsitektur.

    cu/gpt-5.6-sol-high

    kr/claude-sonnet-5-thinking

    cx/gpt-5.6-terra

2. Judge-Architect (Mode: Fusion - panel + judg)
Pengambil keputusan arsitektur tingkat tinggi.

    Panel: cu/claude-opus-4-8-high | ag/gemini-3.1-pro-low | cx/gpt-5.6-terra

    Judge: kr/claude-opus-5-thinking-agentic

3. UI-Frontend-Master (Mode: Fallback - try in order)
Spesialis antarmuka, React, dan Tailwind.

    kr/claude-sonnet-5

    ag/gemini-3.8-flash-high

    cu/gpt-5.6-luna-high

4. Docs-and-Boilerplate (Mode: Round Robin - rotate)
Penulis dokumentasi dan perapih struktur file.
(Catatan: Kamu menyetelnya di mode Round Robin, artinya beban akan dibagi rata bergantian ke 3 model ini tiap kali ada request).

    cu/claude-fable-5-1-thinking-max

    cu/claude-4.5-opus-high

    kr/claude-haiku-4.5

5. Deep-Debugger (Mode: Fusion - panel + judg)
Pembongkar bug dan penganalisis log terminal yang rumit.

    Panel: cu/claude-fable-5-thinking-xhigh | kr/gpt-5.6-terra-thinking | cu/gpt-5.6-sol-high

    Judge: kr/claude-opus-5-thinking-agentic