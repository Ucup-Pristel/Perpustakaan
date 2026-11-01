#!/usr/bin/env bash
#
# ucup-edu-lib :: PostgreSQL logical backup / verify / restore for the portable
# Compose stack (infra/compose.prod.yaml). PostgreSQL -> PostgreSQL only.
# The SQLite importer (scripts/import-sqlite-to-pg.js) is for the ONE initial migration.
#
#   export EDULIB_ENV_FILE=/opt/edulib/prod.env   # required, outside git
#   scripts/pg-portable.sh backup                 # -> $BACKUP_DIR/edulib-<db>-<UTC>.sql.gz (+ .sha256)
#   scripts/pg-portable.sh verify  <file.sql.gz>  # restore test into throwaway DB, then drop it
#   scripts/pg-portable.sh report                 # rows + md5 per table, sequence state
#   CONFIRM_RESTORE=<project>/<db> scripts/pg-portable.sh restore <file.sql.gz>
#
# Runs through `docker compose exec` on the private postgres service over its
# local socket: no published port, no password on argv or in logs.
# Plain SQL (not -Fc): pipe-safe through `docker exec`, restored by psql in ONE transaction.
# Project: COMPOSE_PROJECT_NAME (default edulib-prod). Files: COMPOSE_FILE (default prod).
set -Eeuo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${EDULIB_ENV_FILE:?set EDULIB_ENV_FILE to the env file outside the repo}"
PROJECT="${COMPOSE_PROJECT_NAME:-edulib-prod}"
export COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/compose.prod.yaml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/edulib}"
KEEP_DAYS="${KEEP_DAYS:-14}"

log() { printf '[pg-portable] %s %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { printf '[pg-portable] ERROR %s\n' "$*" >&2; exit 1; }
dc()  { docker compose --env-file "$EDULIB_ENV_FILE" -p "$PROJECT" "$@"; }
# psql over the container's local socket. $1 = database, $2 = admin|app. SQL on stdin.
psql_in() { dc exec -T -e TARGET_DB="$1" -e AS="$2" postgres sh -c \
  'u=$POSTGRES_USER; [ "$AS" = app ] && u=$APP_DB_USER; psql -X -v ON_ERROR_STOP=1 -qAt -F"|" -U "$u" -d "$TARGET_DB"'; }
pgenv() { dc exec -T postgres sh -c "printf %s \"\$$1\""; }
# No `grep -q`: early exit + pipefail can turn SIGPIPE into a false negative.
running() { dc ps --status running --services | grep -x "$1" > /dev/null; }

[ -r "$EDULIB_ENV_FILE" ] || die "env file not readable: $EDULIB_ENV_FILE"
running postgres || die "postgres not running in project $PROJECT"
DB="$(pgenv APP_DB_NAME)"

# Fingerprint: per-table row count + md5 over all rows, then each serial
# sequence's max(id) and next value. Diff two reports to prove equality.
# ponytail: string_agg holds one table in memory; fine for MVP size, switch to per-chunk hashing past ~100 MB/table.
report() {
  psql_in "$1" admin <<'SQL'
SET TimeZone = 'UTC';
SELECT format($q$SELECT 'table', %L, count(*), coalesce(md5(string_agg(t::text, E'\n' ORDER BY t::text)), '-') FROM public.%I t$q$, table_name, table_name)
  FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name
\gexec
SELECT format($q$SELECT 'seq', %L, (SELECT coalesce(max(%I), 0) FROM public.%I), CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM %s$q$,
              table_name || '.' || column_name, column_name, table_name, pg_get_serial_sequence(format('public.%I', table_name), column_name))
  FROM information_schema.columns WHERE table_schema = 'public' AND column_default LIKE 'nextval(%' ORDER BY table_name, column_name
\gexec
SELECT 'constraints', contype, count(*), count(*) FILTER (WHERE NOT convalidated)
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace GROUP BY contype ORDER BY contype;
SQL
}

# Fails if any sequence would hand out an existing id, or a constraint is unvalidated.
check_report() {
  awk -F'|' '$1=="seq" { n++; if ($4 <= $3) { bad=1; print "[pg-portable] ERROR sequence " $2 " next=" $4 " <= max_id=" $3 > "/dev/stderr" } }
             $1=="constraints" && $4 != 0 { bad=1; print "[pg-portable] ERROR unvalidated constraints type " $2 ": " $4 > "/dev/stderr" }
             END { if (bad) exit 1; if (!n) { print "[pg-portable] ERROR no sequences found" > "/dev/stderr"; exit 1 } }'
}

# As the app role: restored objects are owned by it. -1 = single transaction, all or nothing.
restore_into() {
  gzip -dc "$2" | dc exec -T -e TARGET_DB="$1" -e PGOPTIONS='-c client_min_messages=warning' postgres sh -c \
    'psql -X -q -1 -v ON_ERROR_STOP=1 -U "$APP_DB_USER" -d "$TARGET_DB"' > /dev/null
}

check_file() {
  [ -f "$1" ] || die "backup not found: $1"
  [ -f "$1.sha256" ] || die "checksum missing: $1.sha256"
  (cd "$(dirname "$1")" && sha256sum --check --status "$(basename "$1").sha256") || die "sha256 mismatch: $1"
  gzip -t "$1" || die "corrupt gzip: $1"
}

case "${1:-}" in
  backup)
    # BACKUP_DB: dump another DB in the same cluster (e.g. edulib_import_staging after the
    # one-time SQLite import). Default: the app DB. Restore always targets the app DB.
    SRC_DB="${BACKUP_DB:-$DB}"
    [[ "$SRC_DB" =~ ^[a-z_][a-z0-9_]*$ ]] || die "invalid BACKUP_DB: $SRC_DB"
    mkdir -p "$BACKUP_DIR"
    NAME="edulib-$SRC_DB-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
    OUT="$BACKUP_DIR/$NAME"
    [ ! -e "$OUT" ] || die "refusing to overwrite $OUT"
    log "pg_dump $PROJECT/$SRC_DB -> $OUT"
    # One consistent MVCC snapshot: schema, data, PK/FK constraints, setval() for sequences.
    dc exec -T -e TARGET_DB="$SRC_DB" postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$TARGET_DB" --no-owner --no-privileges' \
      | gzip -6 > "$OUT.partial" || { rm -f "$OUT.partial"; die "pg_dump failed"; }
    mv "$OUT.partial" "$OUT"
    (cd "$BACKUP_DIR" && sha256sum "$NAME" > "$NAME.sha256")
    log "ok $(du -h "$OUT" | cut -f1) sha256=$(cut -d' ' -f1 "$OUT.sha256")"
    # Retention only after a successful backup; exact name pattern only.
    find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "edulib-$SRC_DB-*.sql.gz" -o -name "edulib-$SRC_DB-*.sql.gz.sha256" \) -mtime "+$KEEP_DAYS" -print -delete >&2
    printf '%s\n' "$OUT"
    ;;
  verify)
    FILE="${2:?usage: verify <file.sql.gz>}"
    check_file "$FILE"
    SCRATCH="edulib_verify_$(date -u +%Y%m%d%H%M%S)_$$"
    log "restore test into throwaway database $SCRATCH"
    printf 'CREATE DATABASE "%s" OWNER "%s" TEMPLATE template0;\n' "$SCRATCH" "$(pgenv APP_DB_USER)" | psql_in postgres admin
    trap 'printf "DROP DATABASE IF EXISTS \"%s\" WITH (FORCE);\n" "$SCRATCH" | psql_in postgres admin || log "WARN drop $SCRATCH manually"' EXIT
    restore_into "$SCRATCH" "$FILE"
    report "$SCRATCH" | tee /dev/stderr | check_report
    log "verify ok: $FILE"
    ;;
  report)
    R="$(report "$DB")"
    printf '%s\n' "$R"
    printf '%s\n' "$R" | check_report
    ;;
  restore)
    FILE="${2:?usage: restore <file.sql.gz>}"
    [ "${CONFIRM_RESTORE:-}" = "$PROJECT/$DB" ] || die "refusing: set CONFIRM_RESTORE=$PROJECT/$DB"
    if running api; then die "refusing: stop api first ($PROJECT)"; fi
    check_file "$FILE"
    N="$(printf "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public';\n" | psql_in "$DB" admin)"
    [ "$N" = "0" ] || die "refusing: $PROJECT/$DB is not empty ($N relations). No merge/overwrite mode."
    log "restoring $FILE into $PROJECT/$DB"
    restore_into "$DB" "$FILE"
    report "$DB" | tee /dev/stderr | check_report
    log "restore ok. Diff this report against the source report before starting api."
    ;;
  *) die "usage: $0 <backup|verify FILE|report|restore FILE>" ;;
esac
