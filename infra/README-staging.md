# EduLib API Docker staging (Linode)

Separate Compose project (`edulib-staging`) attached to the existing PostgreSQL stack through the external Docker network `edulib_database`. It never defines a `postgres` service or PostgreSQL volumes. The API container never runs migrations on startup; schema changes happen only through the explicit one-shot command in step 5.

## 0. Prerequisites

- `/opt/edulib/compose.yaml` runs PostgreSQL 17 (project `edulib`, network `edulib_database`).
- Docker Engine + Compose on the Linode.
- Branch with these files pushed to GitHub. `pg` is already in `package.json` and `package-lock.json`.
- Do **not** merge into `main`: the old GitHub Actions deployment still targets the legacy SQLite VPS.

## 1. Create the staging database and role (Linode)

```bash
cd /opt/edulib
sudo docker compose ps
sudo docker network inspect edulib_database --format '{{.Name}}'
sudo docker compose exec postgres psql -U edulib_admin -d edulib
```

Inside `psql`, one line at a time:

```sql
CREATE ROLE edulib_staging LOGIN;
\password edulib_staging
CREATE DATABASE edulib_staging OWNER edulib_staging;
\q
```

`\password` keeps the password out of shell history. Use a unique staging password, never the admin password. If the objects exist, inspect them instead of re-creating. The staging role owns only `edulib_staging`; it must not be granted access to the production database.

## 2. Stage the repository and secrets

```bash
cd /opt/edulib
git clone --branch <branch> https://github.com/Ucup-Pristel/Perpustakaan.git source
cp source/infra/staging.env.example staging.env
chmod 600 staging.env
nano staging.env
```

Replace placeholders; JWT secret via `openssl rand -hex 48`. Keep Resend/R2 secrets out of staging. If `source/` exists, `git -C source fetch && git -C source checkout <branch> && git -C source pull --ff-only` instead of cloning. Never paste `staging.env` into chat, GitHub, or screenshots.

## 3. Shorthand

All commands below run from `/opt/edulib/source`:

```bash
cd /opt/edulib/source
DC="sudo docker compose --env-file /opt/edulib/staging.env -f infra/compose.staging.yaml"
```

## 4. Validate and build (no containers started)

```bash
$DC config --quiet
$DC build api
```

## 5. One-shot migration of `edulib_staging`

`scripts/migrate-staging.js` runs in a throwaway `api` container (`run --rm`: same image, env, read-only filesystem and networks; no published ports). Before opening any connection it rejects the run unless:

- `DB_CLIENT=pg`;
- `DB_DATABASE` and `DB_USER` both end in `_staging` (so `edulib` / `edulib_admin` are refused);
- for `latest`, `CONFIRM_STAGING_DB` equals `DB_DATABASE` exactly.

After connecting it re-checks `current_database()` / `current_user` on the server.

```bash
# a. Check target + pending list. Applies no migration; Knex only creates its
#    empty knex_migrations / knex_migrations_lock bookkeeping tables if missing.
$DC run --rm api node scripts/migrate-staging.js status

# b. Apply (only after reading the output of a.)
$DC run --rm -e CONFIRM_STAGING_DB=edulib_staging api node scripts/migrate-staging.js latest

# c. Confirm: expect "pending: 0"
$DC run --rm api node scripts/migrate-staging.js status
```

Verify the schema directly (read-only):

```bash
cd /opt/edulib
sudo docker compose exec postgres psql -U edulib_admin -d edulib_staging -c '\dt'
sudo docker compose exec postgres psql -U edulib_admin -d edulib_staging \
  -c 'SELECT name, batch FROM knex_migrations ORDER BY id;'
```

Expected tables: `users`, `fields`, `sub_fields`, `contents`, `content_paths`, `notes`, `reading_progress`, `user_progress`, `password_reset_tokens`, plus `knex_migrations` and `knex_migrations_lock`. Tables must be owned by `edulib_staging`.

### Failure recovery

- Guard refusal (`Menolak: ...`): nothing was connected or written. Fix `staging.env` and retry.
- Migration error: Knex runs the whole batch in one transaction, and PostgreSQL DDL is transactional, so the batch is rolled back. Run `status` again; the failed files are still `pending`. Fix the code, rebuild (`$DC build api`), re-run step 5.
- `Migration table is already locked`: only after confirming no other migration container is running (`sudo docker ps`), clear the lock: `$DC run --rm api node node_modules/knex/bin/cli.js migrate:unlock`. Run it only against staging; this compose env always points to `edulib_staging`.
- Unrecoverable staging schema: staging is disposable. As `edulib_admin`, `DROP DATABASE edulib_staging;` then `CREATE DATABASE edulib_staging OWNER edulib_staging;` and repeat step 5. **Double-check the database name: never drop `edulib`.**

## 6. Start API and verify

```bash
$DC up -d
$DC ps
curl -i http://127.0.0.1:18081/api/health
curl -s http://127.0.0.1:18081/api/fields
```

`/api/health` only proves the process answers. `/api/fields` returning `{"status":"success","data":[]}` proves the API can query the migrated schema. Then proceed with functional API testing.

An empty database has no admin. Create one in a throwaway container. The password is read with `read -s` (not in shell history, not a CLI argument) and passed through `sudo --preserve-env`, because `sudo` drops the caller's environment by default:

```bash
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
sudo --preserve-env=ADMIN_PASSWORD docker compose --env-file /opt/edulib/staging.env \
  -f infra/compose.staging.yaml run --rm \
  -e ADMIN_EMAIL='<email>' -e ADMIN_NAME='<name>' -e ADMIN_PASSWORD \
  api node scripts/create-admin.js
unset ADMIN_PASSWORD
```

Only `127.0.0.1:18081` is bound. In Termius add local forwarding `18081` -> remote `127.0.0.1:18081`. **Do not open 18081 in the Linode Cloud Firewall.**

## 7. Constraints

- No Resend/R2 credentials on staging: upload and email routes will fail by design.
- Express uses `trust proxy: 1`; `infra/nginx/staging.conf` must keep overwriting `X-Forwarded-For`.
- No root SSH, no public PostgreSQL port, no production DNS or PM2 changes.
- The PostgreSQL stack is managed only by `/opt/edulib/compose.yaml`.
- Stop staging only: `$DC stop`. Never run `docker compose down -v` against the PostgreSQL project, and never publish staging on `0.0.0.0`.
- Sample seed data (`npm run seed -- --sample`) is a local-development tool and is not shipped in the image.
