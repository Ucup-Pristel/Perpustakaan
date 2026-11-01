#!/bin/sh
# Runs ONCE, only when the pgdata volume is empty (docker-entrypoint-initdb.d).
# Creates the least-privilege application role + database from env vars.
# Password goes through a psql variable (:'pw'), never argv, never logged.
set -eu

: "${APP_DB_NAME:?}" "${APP_DB_USER:?}" "${APP_DB_PASSWORD:?}"

# Identifiers are interpolated as psql :"vars" (quoted), but keep them boring.
for v in "$APP_DB_NAME" "$APP_DB_USER"; do
  case "$v" in
    *[!a-z0-9_]*|[0-9]*|'') echo "init-app-role: invalid identifier '$v' (use [a-z_][a-z0-9_]*)" >&2; exit 1 ;;
  esac
done
[ "$APP_DB_USER" != "$POSTGRES_USER" ] || { echo "init-app-role: APP_DB_USER must differ from POSTGRES_ADMIN_USER" >&2; exit 1; }

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v db="$APP_DB_NAME" -v role="$APP_DB_USER" -v pw="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE :"role" LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE :"db" OWNER :"role" ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO :"role";
\connect :"db"
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO :"role";
SQL
echo "init-app-role: created role and database (names from APP_DB_USER / APP_DB_NAME)"
