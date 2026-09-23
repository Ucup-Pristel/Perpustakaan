#!/usr/bin/env bash
#
# ucup-edu-lib :: Backup DB SQLite
#
# Pakai `sqlite3 .backup` / `VACUUM INTO`, BUKAN cp — menyalin file WAL yang
# sedang aktif bisa menghasilkan backup rusak yang baru ketahuan saat restore.
#
# Cron harian 02:00, simpan 14 hari:
#   0 2 * * * /home/Perpustakaan/Perpustakaan/scripts/backup.sh >> /var/log/ucup-backup.log 2>&1
#
# Restore:
#   pm2 stop perpustakaan-api
#   gunzip -c backups/ucup-edu-lib-YYYYmmdd-HHMMSS.db.gz > database/ucup-edu-lib.db
#   pm2 start perpustakaan-api
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${DB_PATH:-$ROOT/database/ucup-edu-lib.db}"
DEST="${BACKUP_DIR:-$ROOT/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
OUT="$DEST/ucup-edu-lib-$(date +%Y%m%d-%H%M%S).db"

log() { printf '[backup] %s %s\n' "$(date -Is)" "$*"; }
die() { printf '[backup] ERROR %s\n' "$*" >&2; exit 1; }

[ -f "$DB" ] || die "DB tidak ditemukan: $DB"
mkdir -p "$DEST"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$OUT'" || die "sqlite3 .backup gagal"
else
  # Fallback: VACUUM INTO lewat node — tetap konsisten. `cp` TIDAK dipakai.
  log "sqlite3 CLI tidak ada, memakai fallback node"
  node -e '
    const s = require("sqlite3");
    const [src, dst] = process.argv.slice(1);
    const db = new s.Database(src, s.OPEN_READONLY, (e) => {
      if (e) { console.error(e.message); process.exit(1); }
      db.run("VACUUM INTO ?", [dst], (err) => {
        if (err) { console.error(err.message); process.exit(1); }
        db.close();
      });
    });
  ' "$DB" "$OUT" || die "fallback node gagal"
fi

# Verifikasi SEBELUM rotasi menghapus backup lama. Backup yang tidak bisa dibuka
# lebih berbahaya daripada tidak ada backup: memberi rasa aman palsu.
# Verifikasi berjalan di KEDUA jalur (sqlite3 CLI maupun node) — kalau hanya
# dijalankan saat CLI tersedia, mesin tanpa sqlite3 diam-diam tidak pernah
# memverifikasi apa pun.
if command -v sqlite3 >/dev/null 2>&1; then
  RESULT="$(sqlite3 "$OUT" 'PRAGMA integrity_check' 2>&1 || true)"
  [ "$RESULT" = "ok" ] || die "integrity_check backup gagal: $RESULT"
  log "integrity ok, contents=$(sqlite3 "$OUT" 'SELECT COUNT(*) FROM contents' 2>/dev/null || echo '?')"
else
  node -e '
    const s = require("sqlite3");
    const out = process.argv[1];
    const db = new s.Database(out, s.OPEN_READONLY, (e) => {
      if (e) { console.error("buka backup gagal:", e.message); process.exit(1); }
      db.get("PRAGMA integrity_check", (e2, row) => {
        if (e2) { console.error(e2.message); process.exit(1); }
        if (row.integrity_check !== "ok") {
          console.error("integrity_check:", row.integrity_check); process.exit(1);
        }
        db.get("SELECT COUNT(*) c FROM contents", (e3, r) => {
          if (e3) { console.error(e3.message); process.exit(1); }
          console.log(`[backup] integrity ok, contents=${r.c}`);
          db.close();
        });
      });
    });
  ' "$OUT" || die "verifikasi backup gagal"
fi

gzip -f "$OUT" || die "gzip gagal"
log "selesai: $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"

DELETED="$(find "$DEST" -maxdepth 1 -name 'ucup-edu-lib-*.db.gz' -mtime "+$KEEP_DAYS" -print -delete | wc -l)"
[ "$DELETED" -gt 0 ] && log "rotasi: $DELETED backup lama dihapus"
log "total backup tersimpan: $(find "$DEST" -maxdepth 1 -name 'ucup-edu-lib-*.db.gz' | wc -l)"
