#!/usr/bin/env bash
#
# ucup-edu-lib :: Deploy backend di VPS
#
# Dijalankan oleh .github/workflows/deploy-backend.yml lewat SSH, atau manual:
#   ./scripts/deploy.sh
#
# Urutan sengaja: backup -> pull -> deps -> migrate -> restart -> health check.
# Kalau health check gagal, kode dikembalikan ke commit sebelumnya dan service
# di-restart lagi. DB TIDAK dipulihkan otomatis — restore DB itu destruktif dan
# bisa membuang tulisan yang masuk setelah backup, jadi path backup-nya dicetak
# untuk keputusan manual.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_NAME="${APP_NAME:-perpustakaan-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-10}"
HEALTH_DELAY="${HEALTH_DELAY:-3}"

log()  { printf '[deploy] %s %s\n' "$(date -Is)" "$*"; }
die()  { printf '[deploy] ERROR %s\n' "$*" >&2; exit 1; }

PREV_SHA="$(git rev-parse HEAD)"
log "commit sekarang: $PREV_SHA"

# 1. Backup sebelum apa pun menyentuh DB. Gagal backup = batalkan deploy.
log "backup DB..."
./scripts/backup.sh || die "backup gagal, deploy dibatalkan"
LATEST_BACKUP="$(find "$ROOT/backups" -maxdepth 1 -name 'ucup-edu-lib-*.db.gz' -printf '%T@ %p\n' \
  | sort -rn | head -1 | cut -d' ' -f2-)"
log "backup: $LATEST_BACKUP"

# Kembalikan kode ke commit sebelumnya lalu restart. Dipakai saat migrate atau
# health check gagal.
rollback_code() {
  log "ROLLBACK kode ke $PREV_SHA"
  git reset --hard "$PREV_SHA" || log "git reset gagal"
  npm ci --omit=dev || log "npm ci saat rollback gagal"
  pm2 restart "$APP_NAME" --update-env || log "pm2 restart saat rollback gagal"
  log "kode sudah kembali. DB TIDAK dipulihkan otomatis."
  log "kalau migrasi mengubah schema, pulihkan manual:"
  log "  pm2 stop $APP_NAME"
  log "  gunzip -c $LATEST_BACKUP > database/ucup-edu-lib.db"
  log "  pm2 start $APP_NAME"
}

# 2. Ambil kode baru.
log "git pull..."
git pull --ff-only origin main || die "git pull gagal"
NEW_SHA="$(git rev-parse HEAD)"
log "commit baru: $NEW_SHA"

# 3. Dependency dari lockfile (bukan `npm install` yang bisa menggeser versi).
log "npm ci --omit=dev..."
if ! npm ci --omit=dev; then
  rollback_code
  die "npm ci gagal"
fi

# 4. Migrasi. Ini langkah wajib — schema tidak lagi dibuat saat startup.
log "menjalankan migrasi..."
if ! npm run migrate; then
  rollback_code
  die "migrasi gagal"
fi

# 5. Restart service.
log "restart $APP_NAME..."
if ! pm2 restart "$APP_NAME" --update-env; then
  rollback_code
  die "pm2 restart gagal"
fi

# 6. Health check. `pm2 restart` sukses TIDAK berarti aplikasi sehat —
# proses bisa hidup lalu langsung crash, atau gagal konek DB.
log "health check $HEALTH_URL..."
for i in $(seq 1 "$HEALTH_RETRIES"); do
  CODE="$(curl -s -o /tmp/ucup-health.json -w '%{http_code}' --max-time 5 "$HEALTH_URL" || echo 000)"
  if [ "$CODE" = "200" ]; then
    log "health OK ($(cat /tmp/ucup-health.json))"
    log "deploy selesai: $PREV_SHA -> $NEW_SHA"
    exit 0
  fi
  log "  percobaan $i/$HEALTH_RETRIES: HTTP $CODE, tunggu ${HEALTH_DELAY}s"
  sleep "$HEALTH_DELAY"
done

log "health check GAGAL setelah $HEALTH_RETRIES percobaan"
pm2 logs "$APP_NAME" --lines 30 --nostream || true
rollback_code
die "deploy dibatalkan, kode dikembalikan ke $PREV_SHA"
