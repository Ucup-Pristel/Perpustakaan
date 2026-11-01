#!/usr/bin/env bash
#
# ucup-edu-lib :: clean-room rehearsal of the portable stack (synthetic data only).
# Two throwaway Compose projects simulate "old VPS" (src) and "new VPS" (dst):
#   src: postgres + api, guarded migration, synthetic data, backup + verify
#   dst: postgres, guarded restore, api + nginx (self-signed TLS, loopback only), smoke tests
# Never touches other projects. Removes only its own projects/volumes/temp dir.
#
#   docker build -f infra/Dockerfile.api -t edulib-api:t11-rehearsal .
#   EDULIB_API_IMAGE=edulib-api:t11-rehearsal test/portable-rehearsal.sh
set -Eeuo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC=edulib-t11-src
DST=edulib-t11-dst
IMP=edulib-t11-imp   # first Docker VPS: one-time SQLite import path
HTTP_PORT="${REHEARSAL_HTTP_PORT:-18480}"
HTTPS_PORT="${REHEARSAL_HTTPS_PORT:-18443}"
IMAGE="${EDULIB_API_IMAGE:-edulib-api:t11-rehearsal}"
mkdir -p /tmp/opencode
WORK="$(mktemp -d /tmp/opencode/edulib-rehearsal.XXXXXX)"
export COMPOSE_FILE="$ROOT/infra/compose.prod.yaml"
PASS=0

log()  { printf '[rehearsal] %s\n' "$*"; }
ok()   { PASS=$((PASS + 1)); printf '[rehearsal] PASS %02d %s\n' "$PASS" "$*"; }
fail() { printf '[rehearsal] FAIL %s\n' "$*" >&2; exit 1; }
# NOTE: always `cmd || fail; ok`. `cmd && ok` does NOT stop on failure under set -e.
# Each project = one simulated VPS with its OWN env file (fresh secrets per VPS).
envf() { printf '%s/%s.env' "$WORK" "$1"; }
dc()   { local p="$1"; shift; docker compose --env-file "$(envf "$p")" -p "$p" "$@"; }
pgp()  { local p="$1"; shift; EDULIB_ENV_FILE="$(envf "$p")" COMPOSE_PROJECT_NAME="$p" BACKUP_DIR="$WORK/backups" "$ROOT/scripts/pg-portable.sh" "$@"; }
app_sql() { dc "$1" exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -qAt -U "$APP_DB_USER" -d "$APP_DB_NAME"'; }
q()    { printf '%s\n' "$2" | app_sql "$1"; }
api()  { curl -sk --max-time 15 "https://127.0.0.1:$HTTPS_PORT$1" "${@:2}"; }
code() { curl -sk --max-time 15 -o /dev/null -w '%{http_code}' "$@"; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));if(v===undefined)process.exit(1);console.log(typeof v==="object"?JSON.stringify(v):v)})' "$1"; }
# Expect failure, and stderr matching a pattern.
refused() {
  local re="$1"; shift
  if "$@" > "$WORK/out" 2> "$WORK/err"; then fail "expected refusal: $*"; fi
  grep -E "$re" "$WORK/err" > /dev/null || { cat "$WORK/err" >&2; fail "wrong refusal (want /$re/): $*"; }
}

cleanup() {
  local rc=$?
  log "cleanup (exit $rc): removing only projects $SRC, $DST, $IMP and $WORK"
  for p in "$SRC" "$DST" "$IMP"; do dc "$p" down -v --remove-orphans > /dev/null 2>&1 || log "WARN cleanup $p failed"; done
  rm -rf "$WORK"
  exit "$rc"
}

for p in "$SRC" "$DST" "$IMP"; do
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$p")" ] || fail "project $p already exists; refusing to reuse it"
  [ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$p")" ] || fail "volumes of $p already exist"
done
docker image inspect "$IMAGE" > /dev/null || fail "image $IMAGE missing; build infra/Dockerfile.api first"
trap cleanup EXIT

# --- synthetic config: random secrets, fake external credentials, loopback ports ---
mkdir -p "$WORK/tls" "$WORK/acme/.well-known/acme-challenge" "$WORK/backups"
rnd() { openssl rand -hex "$1"; }
export ADMIN_PASSWORD; ADMIN_PASSWORD="$(rnd 16)"
JWT="$(rnd 48)"   # same on both VPS: sessions survive the move. DB passwords differ per VPS.
for p in "$SRC" "$DST" "$IMP"; do cat > "$(envf "$p")" <<EOF
POSTGRES_ADMIN_USER=edulib_admin
POSTGRES_ADMIN_PASSWORD=$(rnd 24)
APP_DB_NAME=edulib
APP_DB_USER=edulib_app
APP_DB_PASSWORD=$(rnd 24)
JWT_SECRET=$JWT
FRONTEND_URL=https://edulib.id,https://www.edulib.id
RESEND_API_KEY=re_synthetic_not_real
MAIL_FROM=EduLib Rehearsal <no-reply@example.invalid>
PASSWORD_RESET_BASE_URL=https://edulib.id
R2_ACCOUNT_ID=synthetic
R2_ACCESS_KEY_ID=synthetic
R2_SECRET_ACCESS_KEY=synthetic
R2_BUCKET_NAME=synthetic
R2_PUBLIC_URL=https://r2.example.invalid
TLS_DIR=$WORK/tls
ACME_WEBROOT=$WORK/acme
EDULIB_API_IMAGE=$IMAGE
EDULIB_BIND=127.0.0.1
EDULIB_HTTP_PORT=$HTTP_PORT
EDULIB_HTTPS_PORT=$HTTPS_PORT
EOF
done
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=api.edulib.test' \
  -keyout "$WORK/tls/privkey.pem" -out "$WORK/tls/fullchain.pem" 2> /dev/null
# nginx workers (uid 101) must read cert + webroot; key stays non-world-writable.
chmod 755 "$WORK" "$WORK/tls" "$WORK/acme" "$WORK/acme/.well-known" "$WORK/acme/.well-known/acme-challenge"
# Same modes as infra/certbot-deploy-hook.sh: nginx master (root) reads the key.
chmod 644 "$WORK/tls/fullchain.pem"; chmod 600 "$WORK/tls/privkey.pem"
echo acme-token-ok > "$WORK/acme/.well-known/acme-challenge/t11"
chmod 644 "$WORK/acme/.well-known/acme-challenge/t11"

# ---------------- 1. Compose config ----------------
dc "$SRC" config --quiet || fail "compose config"
ok "compose config valid"
PUB="$(dc "$SRC" config | grep -E '^\s+published:' | tr -d ' "' | sort | tr '\n' ' ')"
[ "$PUB" = "published:$HTTPS_PORT published:$HTTP_PORT " ] || fail "unexpected published ports: $PUB"
HOSTIP="$(dc "$SRC" config | grep -E '^\s+host_ip:' | tr -d ' ' | sort -u)"
[ "$HOSTIP" = "host_ip:127.0.0.1" ] || fail "rehearsal ports not loopback-only: $HOSTIP"
ok "only nginx 80/443 published, loopback-only in rehearsal"

# ---------------- 2. Source: fresh postgres; API startup must NOT migrate ----------------
dc "$SRC" up -d --wait postgres > /dev/null || fail "src postgres"
ok "src postgres healthy (fresh volume, init-app-role ran)"
[ "$(q "$SRC" 'SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user;')" = 'f|f|f' ] || fail "app role privileges"
ok "app role is not superuser/createdb/createrole"
dc "$SRC" up -d --wait --no-build api > /dev/null || fail "src api"
ok "src api healthy on empty DB"
[ "$(q "$SRC" "SELECT to_regclass('public.knex_migrations') IS NULL;")" = t ] || fail "api startup created knex_migrations"
ok "api startup executed no migration (knex_migrations absent)"
dc "$SRC" stop api > /dev/null

# ---------------- 3. Explicit, guarded migration ----------------
refused 'CONFIRM_PROD_DB=edulib' dc "$SRC" run --rm --no-deps api node scripts/migrate-prod.js latest
ok "migrate-prod latest refused without CONFIRM_PROD_DB"
refused 'target staging' dc "$SRC" run --rm --no-deps -e DB_DATABASE=edulib_staging api node scripts/migrate-prod.js status
ok "migrate-prod refuses *_staging target"
refused 'bukan database staging' dc "$SRC" run --rm --no-deps -e CONFIRM_STAGING_DB=edulib api node scripts/migrate-staging.js latest
ok "migrate-staging refuses the prod database"
dc "$SRC" run --rm --no-deps -e CONFIRM_PROD_DB=edulib api node scripts/migrate-prod.js latest > "$WORK/out" || fail "migrate latest"
grep 'pending: 0' "$WORK/out" > /dev/null || fail "migration incomplete"
ok "migrate-prod latest applied"
dc "$SRC" run --rm --no-deps api node scripts/migrate-prod.js status > "$WORK/out" || fail "migrate status"
grep 'selesai: 4, pending: 0' "$WORK/out" > /dev/null || fail "migrate status: $(cat "$WORK/out")"
[ "$(q "$SRC" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user;")" = 11 ] || fail "table ownership"
ok "schema: 4 migrations, 11 tables owned by app role"

# ---------------- 4. Synthetic data on source (gaps: sequence ahead of max id) ----------------
dc "$SRC" run --rm --no-deps -e ADMIN_EMAIL=admin@example.test -e ADMIN_NAME='Admin Sintetis' -e ADMIN_PASSWORD \
  api node scripts/create-admin.js > /dev/null || fail "create-admin"
q "$SRC" "
BEGIN;
INSERT INTO users (email, password_hash, full_name) VALUES
  ('member@example.test', '\$2b\$10\$' || repeat('x', 53), 'Member Sintetis'),
  ('gone@example.test',   '\$2b\$10\$' || repeat('y', 53), 'Dihapus');
DELETE FROM users WHERE email = 'gone@example.test';
INSERT INTO fields (slug, name, sort_order, is_active) VALUES ('tech', 'Teknologi', 1, true), ('art', 'Seni', 2, false), ('tmp', 'Sementara', 3, true);
DELETE FROM fields WHERE slug = 'tmp';
INSERT INTO sub_fields (field_id, slug, name) SELECT id, 'web', 'Web' FROM fields WHERE slug = 'tech';
INSERT INTO sub_fields (field_id, slug, name) SELECT id, 'design', 'Desain' FROM fields WHERE slug = 'art';
INSERT INTO contents (sub_field_id, title, author, is_featured, tags, level)
  SELECT id, 'Buku ' || n, 'Penulis ' || n, n = 1, 'a,b', n FROM sub_fields, generate_series(1, 3) n WHERE slug = 'web';
DELETE FROM contents WHERE title = 'Buku 3';
INSERT INTO content_paths (sub_field_id, from_content_id, to_content_id, path_type)
  SELECT s.id, min(c.id), max(c.id), 'next' FROM sub_fields s, contents c WHERE s.slug = 'web' GROUP BY s.id;
INSERT INTO notes (user_id, content_id, page_number, note_text)
  SELECT u.id, c.id, 2, 'catatan ✓ sintetis' FROM users u, contents c WHERE u.email = 'member@example.test' AND c.title = 'Buku 1';
INSERT INTO reading_progress (user_id, content_id, last_page)
  SELECT u.id, c.id, 12 FROM users u, contents c WHERE u.email = 'member@example.test' AND c.title = 'Buku 2';
INSERT INTO user_progress (user_id, content_id, last_page_read, status)
  SELECT u.id, c.id, 3, 'done' FROM users u, contents c WHERE u.email = 'admin@example.test' AND c.title = 'Buku 1';
INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
  SELECT id, repeat('a', 64), now() + interval '1 hour' FROM users WHERE email = 'member@example.test';
COMMIT;" > /dev/null || fail "synthetic data"
ok "synthetic data inserted (all 9 app tables, id gaps)"

# ---------------- 5. Backup + restore test on source ----------------
BACKUP="$(pgp "$SRC" backup 2> "$WORK/backup.log")" || { cat "$WORK/backup.log" >&2; fail "backup"; }
[[ "$(basename "$BACKUP")" =~ ^edulib-edulib-[0-9]{8}T[0-9]{6}Z\.sql\.gz$ ]] || fail "backup name: $BACKUP"
[ -f "$BACKUP.sha256" ] || fail "no checksum file"
ok "backup created: $(basename "$BACKUP") + .sha256"
grep -E 'POSTGRES_ADMIN_PASSWORD|APP_DB_PASSWORD|JWT' "$WORK/backup.log" > /dev/null && fail "backup log leaks secret names/values"
pgp "$SRC" verify "$BACKUP" 2> "$WORK/verify.log" || { cat "$WORK/verify.log" >&2; fail "verify"; }
[ "$(q "$SRC" "SELECT count(*) FROM pg_database WHERE datname LIKE 'edulib_verify_%';")" = 0 ] || fail "verify left scratch DB"
ok "verify: restored into throwaway DB, sequences/constraints ok, scratch DB dropped"
pgp "$SRC" report > "$WORK/src.report" 2> /dev/null || fail "src report"
grep -c '^table|' "$WORK/src.report" | grep -x 11 > /dev/null || fail "src report tables"
dc "$SRC" stop > /dev/null   # old VPS kept intact (volume preserved) as rollback option

# ---------------- 6. Destination: guarded restore ----------------
dc "$DST" up -d --wait --no-build postgres api > /dev/null || fail "dst postgres+api"
refused 'set CONFIRM_RESTORE=edulib-t11-dst/edulib' pgp "$DST" restore "$BACKUP"
ok "restore refused without CONFIRM_RESTORE"
restore_as() { local c="$1"; shift; CONFIRM_RESTORE="$c" pgp "$DST" restore "$@"; }
refused 'set CONFIRM_RESTORE' restore_as edulib-prod/edulib "$BACKUP"
ok "restore refused when confirmation names another project (edulib-prod)"
refused 'stop api first' restore_as "$DST/edulib" "$BACKUP"
ok "restore refused while api is running"
dc "$DST" stop api > /dev/null
cp "$BACKUP" "$WORK/tampered.sql.gz"; printf 'x' >> "$WORK/tampered.sql.gz"
printf '%s  tampered.sql.gz\n' "$(cut -d' ' -f1 "$BACKUP.sha256")" > "$WORK/tampered.sql.gz.sha256"
refused 'sha256 mismatch' restore_as "$DST/edulib" "$WORK/tampered.sql.gz"
ok "restore refused for tampered backup (checksum)"
[ "$(q "$DST" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")" = 0 ] || fail "refusals wrote to dst"
restore_as "$DST/edulib" "$BACKUP" 2> "$WORK/restore.log" || { cat "$WORK/restore.log" >&2; fail "restore"; }
ok "restore into empty dst succeeded (single transaction)"
refused 'is not empty' restore_as "$DST/edulib" "$BACKUP"
ok "duplicate restore refused (destination not empty)"

# ---------------- 7. Integrity: rows, md5, ids, sequences, FKs ----------------
pgp "$DST" report > "$WORK/dst.report" 2> /dev/null || fail "dst report"
diff "$WORK/src.report" "$WORK/dst.report" || fail "dst != src (rows/md5/sequences/constraints)"
ok "dst report identical to src: 11 tables rows+md5, $(grep -c '^seq|' "$WORK/dst.report") sequences, constraints"
[ "$(q "$DST" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user;")" = 11 ] || fail "restored ownership"
grep -E '^constraints\|f\|' "$WORK/dst.report" | grep -E '^constraints\|f\|[1-9][0-9]*\|0$' > /dev/null || fail "no validated FKs"
q "$DST" "BEGIN; INSERT INTO notes (user_id, content_id, page_number, note_text) VALUES (999999, 1, 1, 'x'); ROLLBACK;" > /dev/null 2>&1 \
  && fail "FK not enforced after restore"
ok "restored tables owned by app role; FKs validated and enforced"
# The FK probe consumed a notes id (sequences are non-transactional): expected ids come from here.
pgp "$DST" report > "$WORK/pre-writes.report" 2> /dev/null || fail "pre-writes report"

# ---------------- 8. API + Nginx on the restored DB ----------------
dc "$DST" up -d --wait --no-build api nginx > /dev/null || fail "dst api+nginx"
ok "dst api + nginx healthy on restored DB"
[ "$(code "https://127.0.0.1:$HTTPS_PORT/api/health")" = 200 ] || fail "https health"
[ "$(code "http://127.0.0.1:$HTTP_PORT/api/health")" = 301 ] || fail "http redirect"
[ "$(curl -s --max-time 5 "http://127.0.0.1:$HTTP_PORT/.well-known/acme-challenge/t11")" = acme-token-ok ] || fail "acme webroot"
[ "$(code "https://127.0.0.1:$HTTPS_PORT/")" = 404 ] || fail "non-api path"
api /api/health -D - -o /dev/null | grep -i '^strict-transport-security:' > /dev/null || fail "HSTS"
ok "TLS health 200, HTTP->HTTPS 301, ACME webroot served, non-API 404, HSTS"
api /api/health -D - -o /dev/null -H 'Origin: https://www.edulib.id' | grep -i '^access-control-allow-origin: https://www.edulib.id' > /dev/null || fail "CORS allow"
api /api/health -D - -o /dev/null -H 'Origin: https://evil.example' | grep -i '^access-control-allow-origin' > /dev/null && fail "CORS allowed foreign origin"
ok "CORS: edulib origin allowed, foreign origin not"

# trust proxy = 1: spoofed X-Forwarded-For must not create a new rate-limit key.
r1="$(api /api/health -D - -o /dev/null -H 'X-Forwarded-For: 203.0.113.1' | tr -d '\r' | awk -F': ' 'tolower($1)=="ratelimit-remaining"{print $2}')"
r2="$(api /api/health -D - -o /dev/null -H 'X-Forwarded-For: 203.0.113.2' | tr -d '\r' | awk -F': ' 'tolower($1)=="ratelimit-remaining"{print $2}')"
[ -n "$r1" ] && [ -n "$r2" ] && [ "$r2" -lt "$r1" ] || fail "XFF spoof changed rate-limit key ($r1 -> $r2)"
ok "spoofed X-Forwarded-For ignored (rate-limit key stable: $r1 -> $r2)"

# Reads
[ "$(api /api/fields | jget meta.total)" = 1 ] || fail "fields read"
B1="$(q "$DST" "SELECT id FROM contents WHERE title = 'Buku 1';")"
B2="$(q "$DST" "SELECT id FROM contents WHERE title = 'Buku 2';")"
[ "$(api "/api/contents/$B1" | jget data.title)" = 'Buku 1' ] || fail "content read"
ok "reads: /api/fields, /api/contents/$B1 from restored data"

# Login with restored bcrypt hash, then writes; new ids must continue the sequences.
TOKEN="$(api /api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"admin@example.test\",\"password\":\"$ADMIN_PASSWORD\"}" | jget token)" || fail "login"
ok "login with restored password hash"
NEXT_USER="$(awk -F'|' '$2=="users.id"{print $4}' "$WORK/pre-writes.report")"
MAX_USER="$(awk -F'|' '$2=="users.id"{print $3}' "$WORK/src.report")"
[ "$NEXT_USER" -gt "$MAX_USER" ] || fail "users sequence not ahead of restored max id"
NEW_USER="$(api /api/auth/register -H 'Content-Type: application/json' -d '{"email":"new@example.test","password":"synthetic-pass","full_name":"Baru"}' | jget data.id)" || fail "register"
[ "$NEW_USER" = "$NEXT_USER" ] || fail "users.id $NEW_USER != expected $NEXT_USER"
NEXT_NOTE="$(awk -F'|' '$2=="notes.id"{print $4}' "$WORK/pre-writes.report")"
NOTE="$(api /api/activity/notes -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"content_id\":$B2,\"page_number\":5,\"note_text\":\"setelah restore\"}" | jget data.id)" || fail "note write"
[ "$NOTE" = "$NEXT_NOTE" ] || fail "notes.id $NOTE != expected $NEXT_NOTE"
api /api/activity/reading-progress -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"content_id\":$B1,\"last_page\":7}" | jget data.last_page | grep -x 7 > /dev/null || fail "progress write"
[ "$(api "/api/activity/reading-progress/$B1" -H "Authorization: Bearer $TOKEN" | jget data.last_page)" = 7 ] || fail "progress read-back"
ok "writes: register id=$NEW_USER, note id=$NOTE (sequences continue), progress round-trip"

# ---------------- 9. Network isolation ----------------
for s in postgres api; do
  [ "$(docker port "$(dc "$DST" ps -q "$s")" | wc -l)" = 0 ] || fail "$s has published ports"
done
[ "$(docker network inspect "${DST}_database" -f '{{.Internal}}')" = true ] || fail "database network not internal"
NGX_NETS="$(docker inspect "$(dc "$DST" ps -q nginx)" -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}')"
[ "$NGX_NETS" = "${DST}_app " ] || fail "nginx networks: $NGX_NETS"
dc "$DST" exec -T nginx nslookup api 127.0.0.11 > /dev/null 2>&1 || fail "control: nginx cannot resolve api"
dc "$DST" exec -T nginx nslookup postgres 127.0.0.11 > /dev/null 2>&1 && fail "nginx can resolve postgres"
dc "$DST" exec -T api node -e "require('net').connect(5432,'postgres').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" || fail "control: api cannot reach postgres"
ok "postgres/api publish no ports; database network internal; nginx cannot resolve postgres, api can"

# ---------------- 10. Persistence + safe recreation ----------------
pgp "$DST" report > "$WORK/dst-after-writes.report" 2> /dev/null || fail "report after writes"
dc "$DST" up -d --force-recreate --no-deps --wait --no-build api > /dev/null || fail "recreate api"
[ "$(code "https://127.0.0.1:$HTTPS_PORT/api/health")" = 200 ] || fail "nginx lost api after api recreation"
ok "api recreated (new IP); nginx re-resolved without restart"
dc "$DST" down > /dev/null || fail "down (no -v)"
docker volume inspect "${DST}_pgdata" > /dev/null || fail "volume removed by plain down"
dc "$DST" up -d --wait --no-build > /dev/null || fail "up after down"
pgp "$DST" report > "$WORK/dst-recreated.report" 2> /dev/null || fail "report after recreate"
diff "$WORK/dst-after-writes.report" "$WORK/dst-recreated.report" || fail "data changed across recreation"
[ "$(api /api/auth/login -H 'Content-Type: application/json' -d '{"email":"new@example.test","password":"synthetic-pass"}' | jget data.id)" = "$NEW_USER" ] || fail "login after recreate"
ok "all containers recreated: volume kept, report identical, post-restore user can log in"

# ---------------- 11. Proxy limits ----------------
[ "$(code -X POST -H 'Content-Type: application/octet-stream' -H 'Content-Length: 115343360' --data-binary '' --max-time 10 "https://127.0.0.1:$HTTPS_PORT/api/admin/upload")" = 413 ] || fail "body > 105m not rejected"
head -c 1048576 /dev/zero > "$WORK/1m.bin"
# Existing contract: no token -> 403 JSON from backend/middleware/auth.js (proves body passed nginx).
UP="$(api /api/admin/upload -X POST -F "pdf=@$WORK/1m.bin;type=application/pdf" -w '|%{http_code}')"
[[ "$UP" == *'Token tidak disediakan'*'|403' ]] || { dc "$DST" logs --no-color --tail 5 nginx api >&2; fail "1 MB upload not passed to Express: $UP"; }
ok "nginx: >105 MB rejected 413; 1 MB multipart reaches Express auth (403 JSON, no token)"
for i in $(seq 1 10); do api /api/auth/login -H 'Content-Type: application/json' -d '{"email":"x@example.test","password":"wrong-pass"}' -o "$WORK/rl.$i" -w '%{http_code}\n'; done > "$WORK/rl.codes"
grep -l '<title>429 Too Many Requests</title>' "$WORK"/rl.* > /dev/null || fail "nginx login rate limit not hit: $(tr '\n' ' ' < "$WORK/rl.codes")"
ok "nginx login rate limit returns 429 ($(tr '\n' ' ' < "$WORK/rl.codes"))"

# ---------------- 12. Secret hygiene ----------------
dc "$SRC" logs --no-color > "$WORK/logs.txt" 2>&1; dc "$DST" logs --no-color >> "$WORK/logs.txt" 2>&1
cat "$WORK"/*.log >> "$WORK/logs.txt"
gzip -dc "$BACKUP" > "$WORK/dump.sql"
for p in "$SRC" "$DST"; do for k in POSTGRES_ADMIN_PASSWORD APP_DB_PASSWORD JWT_SECRET; do
  v="$(grep "^$k=" "$(envf "$p")" | cut -d= -f2-)"
  [ -n "$v" ] || fail "empty $k in $p env"
  grep -F "$v" "$WORK/logs.txt" "$WORK/dump.sql" > /dev/null && fail "$p $k value found in logs or backup"
done; done
grep -F "$ADMIN_PASSWORD" "$WORK/logs.txt" "$WORK/dump.sql" > /dev/null && fail "admin password leaked"
docker image inspect "$IMAGE" -f '{{json .Config.Env}}' | grep -E 'PASSWORD|SECRET|JWT|R2_|RESEND' > /dev/null && fail "secret-like env baked into image"
ok "no secret values in container logs, script logs, backup, or image env"

# ---------------- 13. One-time SQLite import path on a fresh Docker VPS ----------------
# Importer only writes *_staging DBs. Import into a staging DB in the same cluster,
# then pg_dump it and restore into the app DB with the normal guarded restore.
dc "$SRC" down -v > /dev/null; dc "$DST" stop > /dev/null   # free RAM: one postgres at a time
SNAP="$WORK/snapshot.db"
node -e '
  const k = require("knex")({ client: "sqlite3", connection: { filename: process.argv[1] }, useNullAsDefault: true });
  (async () => {
    await k.migrate.latest({ directory: process.argv[2] });
    await k("users").insert({ id: 3, email: "legacy@example.test", password_hash: "$2b$10$" + "z".repeat(53), full_name: "Legacy", role: "member" });
    await k("fields").insert({ id: 2, slug: "legacy", name: "Legacy", is_active: 1 });
    await k("sub_fields").insert({ id: 4, field_id: 2, slug: "legacy-sub", name: "Legacy Sub" });
    await k("contents").insert({ id: 6, sub_field_id: 4, title: "Legacy Book", is_featured: 1 });
    await k("notes").insert({ id: 5, user_id: 3, content_id: 6, page_number: 1, note_text: "legacy note" });
    await k("sqlite_sequence").where({ name: "users" }).update({ seq: 9 });
    await k.destroy();
  })().catch((e) => { console.error(e.message); process.exit(1); });
' "$SNAP" "$ROOT/database/migrations" || fail "synthetic SQLite snapshot"
dc "$IMP" up -d --wait --no-build postgres > /dev/null || fail "imp postgres"
export IMP_PW; IMP_PW="$(rnd 24)"
dc "$IMP" exec -T -e IMP_PW postgres sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -v pw="$IMP_PW"' <<'SQL' || fail "create import staging DB"
CREATE ROLE edulib_import_staging LOGIN PASSWORD :'pw';
CREATE DATABASE edulib_import_staging OWNER edulib_import_staging;
SQL
impr() { dc "$IMP" run --rm --no-deps -e DB_DATABASE=edulib_import_staging -e DB_USER=edulib_import_staging -e DB_PASSWORD="$IMP_PW" "$@"; }
impr -e CONFIRM_STAGING_DB=edulib_import_staging api node scripts/migrate-staging.js latest > /dev/null || fail "migrate import staging"
impr -v "$SNAP:/import/source.db:ro" api node scripts/import-sqlite-to-pg.js --source /import/source.db > "$WORK/out" || { cat "$WORK/out" >&2; fail "import dry-run"; }
impr -v "$SNAP:/import/source.db:ro" -e CONFIRM_IMPORT_DB=edulib_import_staging api node scripts/import-sqlite-to-pg.js --source /import/source.db --apply > "$WORK/out" \
  || { cat "$WORK/out" >&2; fail "import apply"; }
grep 'SELESAI' "$WORK/out" > /dev/null || fail "import not committed"
ok "SQLite snapshot imported into edulib_import_staging (guarded importer, image sqlite3 works)"
IBACK="$(BACKUP_DB=edulib_import_staging pgp "$IMP" backup 2> /dev/null)" || fail "backup import staging"
CONFIRM_RESTORE="$IMP/edulib" pgp "$IMP" restore "$IBACK" 2> /dev/null || fail "restore import into app DB"
pgp "$IMP" report > "$WORK/imp.report" 2> /dev/null || fail "imp report"
grep -x 'table|users|1|.*' "$WORK/imp.report" > /dev/null || fail "imported users"
[ "$(awk -F'|' '$2=="users.id"{print $4}' "$WORK/imp.report")" = 10 ] || fail "sqlite_sequence not honoured (users next != 10)"
dc "$IMP" up -d --wait --no-build api > /dev/null || fail "imp api"
[ "$(q "$IMP" "SELECT owner FROM (SELECT tableowner AS owner FROM pg_tables WHERE tablename = 'notes') t;")" = edulib_app ] || fail "imported tables owner"
ok "import staging DB dumped + restored into app DB: ids kept, users next id 10, owned by app role"

log "ALL $PASS CHECKS PASSED"
