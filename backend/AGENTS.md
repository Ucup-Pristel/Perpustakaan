# Backend Engineering Instructions

This directory contains the Node.js Express REST API.

## Stack

Preserve the existing stack:

- Node.js 22
- Express 4
- CommonJS
- Knex.js
- SQLite
- JWT
- bcrypt
- multer
- Cloudflare R2 through the AWS S3 SDK
- Fuse.js

Do not introduce another backend framework or ORM without a concrete requirement.

## API

The backend runs on port 3000.

Maintain existing `/api/...` route conventions and response contracts.

When modifying an endpoint, inspect its frontend consumers when relevant.

Protected endpoints must continue to use the project's authentication and authorization middleware.

Admin functionality must remain protected appropriately.

## Database

SQLite is the current production database.

Use Knex for database access.

Schema changes must use the project's migration system.

Do not manually mutate the production schema as a substitute for a migration.

Do not delete, reset, truncate, replace, or restore the production database without explicit authorization.

Before changing schema behavior, inspect existing migrations and all affected queries.

## Cloudflare R2

Uploaded PDFs and cover images belong in Cloudflare R2.

The VPS should not become permanent media storage.

Uploads follow the existing pattern:

request → multer → buffer → R2 → URL/path stored in database

Preserve this architecture.

Never expose R2 credentials.

## Authentication & Security

Treat all request input as untrusted.

Pay particular attention to:
- authentication
- authorization
- validation
- SQL/query safety
- upload restrictions
- JWT handling
- password hashing
- rate limiting
- CORS
- proxy trust
- file paths
- object-storage operations

Do not weaken Helmet, rate limiting, CORS, authentication, Nginx proxy boundaries, or authorization merely to make a feature work.

Fix the underlying integration problem instead.

## Search

Search uses Fuse.js plus the existing queryParser synonym system.

Do not replace it with SQL LIKE queries during unrelated work.

Preserve current search behavior unless the requested task concerns search.

## Production Architecture

The backend production path is:

Internet
→ Nginx
→ Express on 127.0.0.1:3000
→ SQLite / Cloudflare R2

PM2 manages the Node process.

Nginx terminates HTTPS.

Do not expose Node port 3000 directly to the public internet.

## Deployment

Backend CI/CD is:

push
→ GitHub Actions tests
→ SSH to VPS
→ scripts/deploy.sh
→ database backup
→ git pull
→ npm ci
→ Knex migrations
→ PM2 restart
→ health check

Preserve this flow.

Do not bypass tests, backups, migrations, or health checks simply to make deployment succeed.

If deployment fails, investigate the real failure.

Do not casually alter rollback behavior.

## Validation

For backend changes, use targeted checks first.

When appropriate run:

- Node syntax checks
- affected tests
- npm test

Database changes require migration verification.

Production-related work should verify `/api/health` and inspect relevant logs after deployment.