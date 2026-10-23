# EduLib API Docker staging (Linode)

This is a **separate Compose project** (`edulib-staging`) connected to the existing PostgreSQL stack via an external Docker network named `edulib_database`. It never defines a `postgres` service or PostgreSQL volumes and does not run database migrations automatically.

## 0. Prerequisites

- Existing `/opt/edulib/compose.yaml` still runs PostgreSQL with project name `edulib` and database network `edulib_database`.
- Docker Engine + Compose installed on Linode.
- `feat/docker-postgresql-infra` branch containing these files is pushed to GitHub.
- The repository must include `pg` in `package.json` **and** `package-lock.json` (`npm install pg --save` on your local branch); otherwise Node fails at startup with `Cannot find module 'pg'`.
- Current Knex migrations contain SQLite-specific SQL; **do not** run migrations yet. `/api/health` is only an HTTP smoke test and does not validate DB tables.

## 1. On your Linux Mint local repo

Check you are on `feat/docker-postgresql-infra`; copy these files into your repo; then run:

```bash
git status
npm install pg --save
node --check backend/server.js
git add .dockerignore infra/ package.json package-lock.json
git commit -m "feat(infra): add isolated Docker API staging"
git push -u origin feat/docker-postgresql-infra
```

Avoid merging `main`: old GitHub Actions deployment still targets the legacy VPS.

## 2. Create a separate staging database and role ON THE LINODE

Use Termius, user `edulib`. Existing PostgreSQL Compose files are under `/opt/edulib`:

```bash
cd /opt/edulib
sudo docker compose ps
sudo docker network inspect edulib_database --format '{{.Name}}'
sudo docker compose exec postgres psql -U edulib_admin -d edulib
```

Inside the interactive `psql` console, execute these lines, **one at a time**:

```sql
CREATE ROLE edulib_staging LOGIN;
\password edulib_staging
CREATE DATABASE edulib_staging OWNER edulib_staging;
\q
```

The `\password` interactive prompt avoids typing the DB password into shell history. Use a unique staging password, not the PostgreSQL administrator password. If these objects already exist, inspect them rather than re-creating them.

## 3. Stage the repository and secrets

```bash
cd /opt/edulib
git clone --branch feat/docker-postgresql-infra https://github.com/Ucup-Pristel/Perpustakaan.git source
cp source/infra/staging.env.example staging.env
chmod 600 staging.env
nano staging.env
```

Replace both placeholder values. Generate JWT secret using `openssl rand -hex 48`. Keep the production Resend/R2 secrets out of staging for now.

Never paste the file contents into chat, GitHub, or screenshots.

## 4. Validate and deploy (ONLY staging containers)

```bash
sudo docker network inspect edulib_database --format '{{.Name}}'
cd /opt/edulib/source
sudo docker compose --env-file /opt/edulib/staging.env \
  -f infra/compose.staging.yaml config --quiet
sudo docker compose --env-file /opt/edulib/staging.env \
  -f infra/compose.staging.yaml build api
sudo docker compose --env-file /opt/edulib/staging.env \
  -f infra/compose.staging.yaml up -d
sudo docker compose --env-file /opt/edulib/staging.env \
  -f infra/compose.staging.yaml ps
curl -i http://127.0.0.1:18081/api/health
```

If `source/` already exists, update/check its branch rather than attempting to clone over it. This service has no port exposed to the internet: only `127.0.0.1:18081` is bound. In Termius, add local port forwarding local port `18081` -> remote `127.0.0.1:18081` to visit it from the laptop. **Do not publish 18081 in Linode Cloud Firewall.**

## 5. Important constraints

- `health` only confirms the API process is answering, not schema compatibility or R2/Resend readiness.
- The staging database is initially empty; authenticated/catalogue routes will not work until schema migrations are fixed and run explicitly against `edulib_staging`.
- Reverse proxy header sanitization (`X-Forwarded-For`) is essential because Express uses `trust proxy: 1`.
- No root SSH, no public PostgreSQL port, no production DNS changes, no PM2 changes.
- Keep the live PostgreSQL stack managed using its original `/opt/edulib/compose.yaml`. The staging compose does not manage it.
- To stop only staging: `sudo docker compose --env-file /opt/edulib/staging.env -f infra/compose.staging.yaml stop`.
- Never run `docker compose down -v` against the PostgreSQL project, and never publish the staging service on `0.0.0.0`.
