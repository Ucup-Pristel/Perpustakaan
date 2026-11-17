# EduLib portable backend deployment (Docker Compose)

One Compose project (`edulib-prod`, file `infra/compose.prod.yaml`) runs PostgreSQL 17, the API and Nginx on any Ubuntu VPS with Docker. It creates its own networks and its own database volume. A new VPS needs only: this repository at a verified commit, one env file, TLS files, and a PostgreSQL backup. No source edits.

Frontend stays on Azure Static Web Apps (`edulib.id`, `www.edulib.id`). Media stays in Cloudflare R2. Email stays on Resend.

## 0. Components and environments

| File | Purpose |
| --- | --- |
| `infra/compose.prod.yaml` | Production stack: `postgres` (private), `api` (private), `nginx` (only public ports 80/443) |
| `infra/prod.env.example` | Env template (placeholders only). Real file: `/opt/edulib/prod.env`, mode 600 |
| `infra/postgres/init-app-role.sh` | First-init only: creates least-privilege app role + DB |
| `infra/nginx/prod.conf` | TLS proxy, ACME webroot, rate limits, 105 MB body limit, XFF replace |
| `infra/certbot-deploy-hook.sh` | Copies renewed Let's Encrypt cert into `TLS_DIR`, reloads nginx |
| `scripts/migrate-prod.js` | Guarded one-shot Knex migration (never on startup) |
| `scripts/pg-portable.sh` | `backup` / `verify` / `report` / `restore` (PostgreSQL to PostgreSQL) |
| `test/portable-rehearsal.sh` | Clean-room rehearsal with synthetic data (local, loopback only) |

| Environment | How it runs | Database |
| --- | --- | --- |
| Legacy production | PM2 + host Nginx, `scripts/deploy.sh` | SQLite file |
| Staging (Linode) | `infra/compose.staging.yaml`, see `infra/README-staging.md` | `edulib_staging` on the external `/opt/edulib/compose.yaml` PostgreSQL stack |
| Portable production | `infra/compose.prod.yaml` (this document) | `edulib` in its own `edulib-prod_pgdata` volume |
| Local rehearsal | `test/portable-rehearsal.sh` | throwaway projects `edulib-t11-*` |

Staging and production never share a database, role, network or Compose project. `migrate-prod.js` refuses `*_staging` targets; `migrate-staging.js` and the SQLite importer refuse anything else.

Three different data paths. Do not mix them up:

1. **Initial SQLite to PostgreSQL migration**: exactly once, legacy VPS to the first Docker VPS (section 4b).
2. **Normal PostgreSQL backup**: `pg-portable.sh backup`, daily (section 5).
3. **PostgreSQL to PostgreSQL restore**: every later VPS move (section 6). Never re-import SQLite.

A copy of the Docker volume is **not** a backup. Only a `pg_dump` file that passed `verify` counts.

### Liveness and readiness

`/api/health` reports process liveness only. `/api/ready` returns 200 only when the database is reachable, its recorded migrations exactly match this release, and the migration lock is clear; otherwise it returns 503 without database details. Probes never create metadata or run migrations. Compose health checks use readiness, so a fresh API remains unhealthy until the explicit migration or restore finishes. This does not replace schema/integrity checks or exercise external R2/email services.

## 1. Fresh VPS setup

Ubuntu 24.04 LTS, 4 vCPU / 8 GB. Compose limits: postgres 2 CPU / 2 GB, api 1.5 CPU / 768 MB, nginx 0.5 CPU / 128 MB. That leaves page cache and room for backups.

```bash
# Docker Engine + Compose plugin (official repository)
sudo apt-get update && sudo apt-get install -y ca-certificates curl git certbot
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker compose version

# Directories (root-owned; nothing here is in git)
sudo install -d -m 0755 /opt/edulib /opt/edulib/acme
sudo install -d -m 0700 /opt/edulib/tls /var/backups/edulib /opt/edulib/import
```

**Firewall.** Inbound: 22 (restricted to admin IPs), 80, 443. Nothing else. Use the provider firewall (Linode Cloud Firewall) as the authority. Docker-published ports bypass `ufw`, which is why the stack publishes only nginx. PostgreSQL and the API have no host ports.

## 2. Release, secrets, image

```bash
cd /opt/edulib
sudo git clone https://github.com/Ucup-Pristel/Perpustakaan.git source
sudo git -C source checkout <approved-commit-sha>        # detached, exact SHA
# PostgreSQL runs this bind-mounted public script as its non-root OS user.
# Some restricted shells clone with umask 077; Git does not record read bits.
sudo chmod 0755 source/infra/postgres/init-app-role.sh
# If your release policy requires signed commits, verification must succeed:
# sudo git -C source verify-commit HEAD

sudo install -m 600 -o root -g root source/infra/prod.env.example /opt/edulib/prod.env
sudo nano /opt/edulib/prod.env
```

Fill `prod.env`:

- `POSTGRES_ADMIN_PASSWORD`, `APP_DB_PASSWORD`: `openssl rand -hex 32`. New values per VPS are fine: the backup carries no role passwords.
- `JWT_SECRET`: **copy the current production value**. A new value logs every user out.
- `R2_*`, `RESEND_API_KEY`, `MAIL_FROM`, `PASSWORD_RESET_BASE_URL`, `FRONTEND_URL`: same as current production.
- `EDULIB_API_IMAGE=edulib-api:<approved-commit-sha>`.

Never paste `prod.env` into chat, tickets or screenshots. Only root reads it (`600`). Never copy it into `source/`.

```bash
cd /opt/edulib/source
DC="sudo docker compose --env-file /opt/edulib/prod.env -f infra/compose.prod.yaml"
$DC config --quiet
sudo docker build -f infra/Dockerfile.api -t "edulib-api:$(git rev-parse HEAD)" .
```

Base images are pinned by digest and `npm ci` uses `package-lock.json`. Debian build packages in the build stage are not pinned. If you need a byte-identical image across VPS moves, push the verified image to a registry and pull it by digest. No registry is set up yet.

## 3. TLS certificates

Nginx reads `TLS_DIR/fullchain.pem` and `TLS_DIR/privkey.pem` as plain files. It also serves `ACME_WEBROOT` at `/.well-known/acme-challenge/`. Certificates live on the host, never in git or the image.

**a. Before DNS points to this VPS** (relocation, pre-cutover testing): copy the current certificate from the old host over SSH.

```bash
# on the old host (legacy path shown; on a Docker VPS use its TLS_DIR)
sudo cp -L /etc/letsencrypt/live/api.edulib.id/fullchain.pem /etc/letsencrypt/live/api.edulib.id/privkey.pem /tmp/
# transfer with scp, then on the new VPS:
sudo install -m 0644 fullchain.pem /opt/edulib/tls/fullchain.pem
sudo install -m 0600 privkey.pem /opt/edulib/tls/privkey.pem
shred -u fullchain.pem privkey.pem   # both hosts, including /tmp copies
```

If you have no certificate yet, use a temporary self-signed one so nginx can start:
`sudo openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj /CN=api.edulib.id -keyout /opt/edulib/tls/privkey.pem -out /opt/edulib/tls/fullchain.pem`

**b. After DNS points to this VPS**: issue the certificate and set up renewal through the running nginx.

```bash
sudo certbot certonly --webroot -w /opt/edulib/acme -d api.edulib.id \
  --deploy-hook /opt/edulib/source/infra/certbot-deploy-hook.sh
sudo certbot renew --dry-run
```

certbot's systemd timer renews the certificate. The deploy hook copies it into `TLS_DIR` and runs `nginx -s reload`. Nginx config is domain-agnostic (`server_name _`), so the certificate decides the name.

## 4. Initial PostgreSQL deployment (first Docker VPS)

All commands run from `/opt/edulib/source` with `DC` from section 2.

```bash
$DC up -d postgres            # first start of an empty volume runs init-app-role.sh
$DC ps                        # postgres: healthy
```

`init-app-role.sh` runs **only** when the volume is empty. It creates `APP_DB_USER` (no superuser, createdb or createrole) and `APP_DB_NAME`, owned by that role. Changing these values later does nothing to an existing volume.

Choose exactly one path before running any API command:

| Intended installation | Procedure | State of the final `APP_DB_NAME` database before starting |
| --- | --- | --- |
| Fresh installation without existing user data | **4a only** | Empty; explicitly migrate it, then create the first admin |
| Import existing SQLite data | **4b only** | Empty until the verified PostgreSQL dump is restored; migrate only the temporary import database |

Keep the API stopped until the chosen path is complete. For an import, do not
run `migrate-prod.js status`, `latest`, `unlock`, seeds or `create-admin.js`
against the final database first. Even `status` may create Knex bookkeeping
tables; restore refuses **any** existing relation, not just user data. Check
emptiness without modifying the schema:

```bash
$DC exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$APP_DB_USER" -d "$APP_DB_NAME"' <<'SQL'
SELECT count(*) AS public_relations
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public';
SQL
# Import path requires public_relations = 0. Otherwise stop and investigate
# the target/project; do not automatically drop tables or a volume.
```

### 4a. Fresh empty installation — no SQLite import

The API never migrates on startup. Migrations run in a throwaway container with a typed confirmation:

```bash
$DC run --rm api node scripts/migrate-prod.js status                      # read pending list
$DC run --rm -e CONFIRM_PROD_DB=edulib api node scripts/migrate-prod.js latest
$DC run --rm api node scripts/migrate-prod.js status                      # expect pending: 0
```

Guards: `DB_CLIENT=pg`, no `*_staging` target, and for `latest`/`unlock` `CONFIRM_PROD_DB` must equal `DB_DATABASE`. After connecting, the server's `current_database()`/`current_user` are checked again. A failed batch rolls back as one transaction (PostgreSQL DDL is transactional).

Create the first admin only for this fresh installation (password read silently,
never in argv). Do not proceed to 4b afterwards:

```bash
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
sudo --preserve-env=ADMIN_PASSWORD docker compose --env-file /opt/edulib/prod.env -f infra/compose.prod.yaml \
  run --rm -e ADMIN_EMAIL='<email>' -e ADMIN_NAME='<name>' -e ADMIN_PASSWORD api node scripts/create-admin.js
unset ADMIN_PASSWORD
```

Start the stack with `$DC up -d --wait`, verify `/api/ready` and the application,
and complete the operational acceptance checklist in section 10. Subsequent
schema updates use the guarded release procedure in section 7.

### 4b. One-time SQLite import (legacy VPS to first Docker VPS)

Skip 4a entirely. The importer writes only to `*_staging` databases. Import into
a temporary `edulib_import_staging` database in the **same private cluster**, then
restore its verified dump into the still-empty final `edulib` database. Do not
seed or create an admin: existing users, password hashes and roles are imported.
If any preflight/guard fails, stop and investigate; do not bypass it. Steps:

1. Freeze writes on legacy: `pm2 stop perpustakaan-api`. Users see errors from now until DNS cutover.
2. Snapshot and transfer as in `infra/README-staging.md` §8 a–b (`VACUUM INTO`, `journal_mode=DELETE`, `sha256sum`, `scp`), into `/opt/edulib/import/edulib-snapshot.db`, mode `0440`, group `1000`.
3. Create the temporary import role and DB (password read silently):

   ```bash
   read -rs IMP_PW && export IMP_PW
   export DB_PASSWORD="$IMP_PW"
   DCI="sudo --preserve-env=IMP_PW,DB_PASSWORD docker compose --env-file /opt/edulib/prod.env -f infra/compose.prod.yaml"
   $DCI exec -T -e IMP_PW postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres' <<'SQL'
   \getenv pw IMP_PW
   CREATE ROLE edulib_import_staging LOGIN PASSWORD :'pw';
   CREATE DATABASE edulib_import_staging OWNER edulib_import_staging;
   SQL
   IMP="-e DB_DATABASE=edulib_import_staging -e DB_USER=edulib_import_staging -e DB_PASSWORD"
   ```

   Pass secret variable **names**, never their values, on the command line. `psql` reads the password with `\getenv`; Docker inherits `DB_PASSWORD` from the environment. `unset IMP_PW DB_PASSWORD IMP DCI` afterwards. Docker administrators can still inspect container environment variables; restrict daemon access.

4. Migrate the import DB, dry-run, then apply:

   ```bash
   SNAP="-v /opt/edulib/import/edulib-snapshot.db:/import/source.db:ro"
   $DCI run --rm --no-deps $IMP -e CONFIRM_STAGING_DB=edulib_import_staging api node scripts/migrate-staging.js latest
   $DCI run --rm --no-deps $IMP $SNAP api node scripts/import-sqlite-to-pg.js --source /import/source.db
   $DCI run --rm --no-deps $IMP $SNAP -e CONFIRM_IMPORT_DB=edulib_import_staging \
     api node scripts/import-sqlite-to-pg.js --source /import/source.db --apply          # expect SELESAI
   ```

5. Keep the API stopped and restore into the empty app database. Do **not** run
   any of 4a first, including `status`. The dump already contains the schema and
   `knex_migrations`. Check the Compose project and database names before setting
   `CONFIRM_RESTORE`; the example below uses the default `edulib-prod/edulib`.

   ```bash
   P="sudo env EDULIB_ENV_FILE=/opt/edulib/prod.env scripts/pg-portable.sh"
   F="$(sudo env EDULIB_ENV_FILE=/opt/edulib/prod.env BACKUP_DB=edulib_import_staging scripts/pg-portable.sh backup)"
   $P verify "$F"
   sudo env EDULIB_ENV_FILE=/opt/edulib/prod.env CONFIRM_RESTORE=edulib-prod/edulib scripts/pg-portable.sh restore "$F"
   $DC run --rm api node scripts/migrate-prod.js status                                    # pending: 0
   $P report                                                                           # inspect rows, constraints, sequences
   ```

6. After successful restore and integrity checks, clean up the temporary database
   and transferred snapshot. Retain the verified dump/checksum securely and keep
   the original frozen SQLite database intact for rollback:

   ```bash
   $DC exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres' <<'SQL'
   DROP DATABASE edulib_import_staging;
   DROP ROLE edulib_import_staging;
   SQL
   sudo shred -u /opt/edulib/import/edulib-snapshot.db
   ```

7. Continue with section 6 **steps 8–12 only** for start, validation, authorized
   cutover and monitoring, keeping the legacy SQLite API stopped throughout.
   Do not run section 6 steps 3–7: those are for PostgreSQL relocation and include
   resetting the destination, which would destroy the import just restored.
   Verify imported row counts, representative records, IDs/FKs and sequence
   continuation against the importer report and retained snapshot before cutover.

**Initial-cutover rollback differs from a PostgreSQL relocation.** Before the new
API accepts writes, the frozen SQLite copy remains a valid rollback source.
After PostgreSQL accepts writes, SQLite is stale: a PostgreSQL dump cannot be
restored into it. No reverse importer is provided. Freeze writes and obtain an
explicit reconciliation/data-loss decision; never blindly restart the old SQLite
API or apply the PostgreSQL-to-PostgreSQL reverse-restore instructions to it.

## 5. Normal PostgreSQL backup

`scripts/pg-portable.sh` runs `pg_dump` inside the `postgres` container over its local socket. No published port and no password in argv or logs. It writes `/var/backups/edulib/edulib-<db>-<YYYYmmddTHHMMSSZ>.sql.gz` plus `.sha256`, mode `600`.

- Consistent: one MVCC snapshot, so the API can stay running.
- Complete: schema, data, primary/foreign keys, indexes, `setval()` for every sequence, `knex_migrations`.
- Fails on any error (`set -Eeuo pipefail`). A failed dump stays as `.partial` and is deleted. It never overwrites an existing file.
- Concurrent backups of the same database/directory are refused with a non-blocking `flock` (Ubuntu `util-linux`); a second job cannot overwrite a partial archive.
- Retention: after a successful backup, files older than `KEEP_DAYS` (default 14) matching the exact name pattern are deleted.

```bash
sudo tee /etc/cron.d/edulib-backup > /dev/null <<'CRON'
15 2 * * * root EDULIB_ENV_FILE=/opt/edulib/prod.env /opt/edulib/source/scripts/pg-portable.sh backup >> /var/log/edulib-backup.log 2>&1
CRON
sudo env EDULIB_ENV_FILE=/opt/edulib/prod.env /opt/edulib/source/scripts/pg-portable.sh backup   # first run, by hand
```

**Verify** = real restore test. It restores into a throwaway `edulib_verify_*` database in one transaction, checks that every sequence is ahead of its max id and every constraint is validated, prints the report, then drops the throwaway DB. Run it weekly and before every relocation:

```bash
sudo env EDULIB_ENV_FILE=/opt/edulib/prod.env scripts/pg-portable.sh verify /var/backups/edulib/<file>.sql.gz
```

If verify is killed hard (SIGKILL, host crash), drop the leftover `edulib_verify_*` database by hand. Never drop anything else.

**Offsite (required).** A backup on the same VPS dies with the VPS. Copy each verified dump plus its `.sha256` to storage outside this provider account, e.g. a **private** R2 bucket separate from the public media bucket, using its own write-only key. Encrypt before upload (`age` or `gpg`): dumps contain emails and password hashes. Keep at least 14 daily and 8 weekly copies offsite. No offsite tooling is included in this repo; choose and set it up before cutover.

## 6. VPS-to-VPS relocation (PostgreSQL to PostgreSQL)

Old = current Docker VPS (`OLD`). New = fresh VPS (`NEW`).

1. **Prepare NEW**: sections 1–3. Use the same approved commit, the same `JWT_SECRET`, R2 and Resend values, and new DB passwords. TLS option 3a.
2. **Lower DNS TTL** of `api.edulib.id` to 300 s at least one old-TTL period before the cutover. Check for an `AAAA` record: this stack publishes IPv4 only (section 9).
3. **Rehearse on NEW** with the latest verified backup copied from OLD (`scp`, then `sha256sum -c`). Run `$DC up -d postgres`, then `CONFIRM_RESTORE=edulib-prod/edulib … restore <file>`, then `$DC up -d`, then step 5 checks. This proves the procedure and timings without user impact.
4. **Reset NEW for the final restore** (restore refuses a non-empty DB). On **NEW only**, after checking `hostname` and the IP:
   `$DC down` and then `sudo docker volume rm edulib-prod_pgdata`. This deletes NEW's rehearsal data only. It is irreversible, so confirm you are not on OLD.
5. **Announce the maintenance window** and **freeze writes on OLD**: `$DC stop api` (OLD). Nginx on OLD now returns 502, so nothing can write.
6. **Final backup on OLD**: `… pg-portable.sh backup`, then `… verify <file>`, then `… report > /root/old.report`. Copy the dump, `.sha256` and `old.report` to NEW.
7. **Final restore on NEW**: `sha256sum -c`, `$DC up -d postgres`, `CONFIRM_RESTORE=edulib-prod/edulib … restore <file>`, `… report > /root/new.report`, then `diff /root/old.report /root/new.report`. It must be empty (same tables, row counts, md5 of rows, sequence state, constraints).
8. **Start NEW**: `$DC up -d` and `$DC ps` (all healthy). Run `migrate-prod.js status` and expect `pending: 0`.
9. **Validate NEW before DNS** from a workstation, without touching DNS:
   - `curl --resolve api.edulib.id:443:<NEW-IP> https://api.edulib.id/api/health` and `/api/fields`.
   - Point `api.edulib.id` to `<NEW-IP>` in your local hosts file. Open `https://edulib.id`, log in, open a book and the reader, save a note.
   - With PM authorization only (real external services): upload and delete one test PDF (R2), and send forgot-password to a test account (Resend).
10. **Switch DNS only after PM authorization**: change the `A` record to NEW. Keep OLD's API **stopped** so clients with a stale DNS cache get errors instead of writing to the old database.
11. **Monitor**: `$DC ps`, `$DC logs -f --tail 100 api nginx`, `/api/health`. Run the first scheduled backup and verify it. Then configure certbot on NEW (3b) once DNS has propagated.
12. **Keep OLD** stopped but intact (volume plus backups) for at least 7 days. Then delete it as a separate, explicit decision.

**No lost writes**: writes stop at step 5, before the final dump. Nothing writes again until NEW serves traffic. The freeze lasts from step 5 to step 10 plus DNS propagation.

**Rollback limits**:

- Before step 10, or after it while NEW has taken **no** writes: point DNS back and run `$DC start api` on OLD. OLD's DB is exactly as it was at the freeze.
- After NEW has accepted writes, the two databases diverge. Going back to OLD **loses** every write made on NEW, unless you freeze NEW, back it up and restore it into an emptied OLD DB (same procedure in reverse). That reverse restore needs OLD's volume reset (step 4 on OLD), which is destructive. It requires an explicit PM decision.
- There is no merge tool. Never run both APIs against live traffic.

## 7. Releases and CI/CD during the migration

`.github/workflows/deploy-backend.yml` (changed in this branch):

- `push` to `main`, and `pull_request` to `main`, run **only** the `test` job: backend syntax checks, frontend lint/build, the complete `test/*.test.js` suite with `--test-concurrency=1` and an ephemeral PostgreSQL service (including real import/rollback tests), `npm audit --omit=dev --audit-level=high`, and the isolated Docker recovery rehearsal. Frontend changes also trigger this gate. CI installs frontend dependencies and requires Chrome/WebSocket (Node 22); Hero, Library and Reader suites fail rather than skip when prerequisites are missing. Frontend deployment remains separate in the Azure Static Web Apps workflow.
- The legacy PM2 deploy job runs only through **Actions, then Run workflow** on `main` with the input `deploy legacy pm2`. It uses the `legacy-production` environment.
- PM setup in GitHub settings: create environment `legacy-production`, add the PM as **required reviewer**, restrict it to branch `main`, and move `VPS_HOST`, `VPS_USERNAME`, `VPS_PASSWORD` from repository secrets into that environment. Until then, the typed phrase and the `main` branch check are the only guards.
- Nothing deploys to the Docker VPS automatically. A Docker release is a PM-approved **commit SHA** that has a green `test` run and a passing `test/portable-rehearsal.sh`. The operator applies it by hand:

```bash
cd /opt/edulib/source && sudo git fetch && sudo git checkout <approved-sha>
sudo docker build -f infra/Dockerfile.api -t edulib-api:<approved-sha> .
sudo env EDULIB_ENV_FILE=/opt/edulib/prod.env scripts/pg-portable.sh backup              # before any change
sudo sed -i 's/^EDULIB_API_IMAGE=.*/EDULIB_API_IMAGE=edulib-api:<approved-sha>/' /opt/edulib/prod.env
$DC run --rm api node scripts/migrate-prod.js status                                      # if pending: latest with CONFIRM_PROD_DB
$DC up -d api && $DC ps
```

Code rollback means setting the previous `EDULIB_API_IMAGE` and running `$DC up -d api`. If the release ran a migration, a schema rollback means restoring the pre-release backup into an emptied DB. That loses writes made since then and needs a PM decision.

Azure deployment stays separate. Its PR preview trigger is limited to `frontend/**`, so an infrastructure/test/runbook-only PR does not deploy a preview. Its existing main-push deployment trigger is preserved; merging a change to that workflow still requires separate deployment authorization. Browser suites run sequentially in the test gate to avoid competing Chromium/PDF processes; assertions and per-condition timeouts are preserved.

## 8. Clean-room rehearsal (local, synthetic)

```bash
docker build -f infra/Dockerfile.api -t edulib-api:t11-rehearsal .
EDULIB_API_IMAGE=edulib-api:t11-rehearsal test/portable-rehearsal.sh
```

It creates and removes only the projects `edulib-t11-src`, `edulib-t11-dst` and `edulib-t11-imp`, plus a temp dir under `/tmp/opencode`. It binds only to `127.0.0.1:18480` and `127.0.0.1:18443`. It refuses to start if those projects already exist. Only one PostgreSQL runs at a time (about 1.5 GB RAM peak). It covers fresh init, no-migration-on-startup, guarded migrations, synthetic data, backup, verify, refused restores (no confirmation, wrong project, API running, tampered file, non-empty target), identical integrity reports, API reads and writes through TLS nginx, sequence continuation, network isolation, container recreation, database outage/recovery readiness, local certificate renewal with hostname/trust verification, proxy limits, secret hygiene, and the one-time SQLite import path. Real certificate authority issuance and production renewal scheduling remain separate operational checks.

## 9. Known limits

- **IPv6**: only IPv4 is published. If `api.edulib.id` has an `AAAA` record, remove it or enable Docker IPv6 before cutover.
- **Single host**: PostgreSQL, API and proxy share one VPS. Recovery time = new VPS + restore (section 6). RPO = time since the last offsite backup (daily) unless you take a manual backup.
- Not exercised locally: real Let's Encrypt issuance and renewal, real R2 and Resend calls, the provider firewall, GitHub environment protection. Verify them during the first real staging rehearsal.
- `pg-portable.sh report` hashes each table in memory. That is fine at MVP size; revisit it above ~100 MB per table.
- Never `docker compose down -v` this project, and never `docker system prune` or `docker volume prune` on the VPS.

## 10. Operational acceptance before production cutover

Repository validation does not authorize production changes. Record an owner,
evidence and a go/no-go decision for each item below on the approved target.

- **Encrypted offsite backups:** provision private storage outside the VPS/provider
  account, dedicated least-privilege upload credentials, separately held recovery
  keys, 14 daily/8 weekly retention and failure alerts. Never use the public media
  bucket. Schedule backup plus verification; a local dump alone is insufficient.
- **Tested recovery:** download and decrypt an offsite backup onto an isolated
  host, verify its checksum, restore, compare integrity reports, and test login,
  reading progress, notes and subsequent IDs. Measure recovery against agreed
  RPO/RTO with representative data; synthetic CI timings do not establish them.
- **TLS:** verify the real hostname/chain, issuance, expiry monitoring, renewal
  timer and deploy hook. A self-signed local renewal test does not prove actual
  certificate-authority issuance or the VPS timer configuration.
- **Firewall:** verify provider rules and IPv4/IPv6 exposure: only required SSH
  (restricted admin sources), HTTP and HTTPS. PostgreSQL and Node must have no
  public ports. Check DNS records without changing them until cutover approval.
- **Secrets and release controls:** provision the external mode-600 env file,
  restrict Docker/admin access, rotate credentials under an approved plan and
  preserve JWT signing continuity where intended. Verify GitHub environment
  reviewers, protected branches and green CI; retain the prior approved image
  digest and pre-change backup. Never put secret values in command arguments.
- **Write freeze:** announce maintenance, stop every old API/writer before the
  final SQLite snapshot, migrate only the transferred copy if needed, and keep
  the old API stopped through validation and DNS propagation. Do not permit two
  writable databases to serve users simultaneously.
- **Rollback:** document the decision point, retained snapshots/images and
  accountable operator. Before new writes, the frozen SQLite copy can be used;
  after new PostgreSQL writes it is stale and needs reconciliation or explicit
  acceptance of lost writes. There is no automatic PostgreSQL-to-SQLite rollback.
- **Cutover verification:** verify `/api/ready`, TLS, imported users/roles and
  representative records, row counts, FKs, sequences, login and reader/activity
  flows before an authorized DNS switch. Validate real R2/email only with separate
  authorization. Monitor errors, readiness, storage and the first scheduled
  offsite backup afterwards; keep the old system stopped but recoverable.
