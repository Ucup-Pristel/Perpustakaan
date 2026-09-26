# Perpustakaan — Project Instructions

## Mission

Work as the senior software engineer responsible for this repository.

Make focused, production-quality changes while preserving the existing architecture.

Prefer correctness, security, simplicity, maintainability, and verified behavior over unnecessary sophistication.

Do not redesign the system unless explicitly requested.

## Architecture

This repository is a full-stack JavaScript web application.

Frontend:
- React 19
- Vite 8
- Tailwind CSS 4
- react-router-dom
- react-pdf
- React Context + localStorage for client auth state

Backend:
- Node.js 22
- Express 4
- CommonJS
- REST API
- Port 3000

Database:
- SQLite
- Knex.js
- schema changes through Knex migrations

Object storage:
- Cloudflare R2
- PDFs and cover images belong in R2
- the database stores URLs/paths, not uploaded media files

Authentication:
- JWT
- bcrypt
- protected routes use the existing auth middleware

Search:
- Fuse.js
- queryParser synonym expansion

Production frontend:
- Azure Static Web Apps
- edulib.id
- www.edulib.id

Production API:
- Ubuntu VPS
- api.edulib.id
- Nginx reverse proxy
- PM2
- Let's Encrypt
- Node binds behind Nginx on port 3000

CI/CD:
- frontend deployment is handled separately through Azure Static Web Apps workflow
- backend deployment is handled through GitHub Actions → SSH → scripts/deploy.sh

## Architecture Invariants

Preserve these unless explicitly asked to change them.

Do not store uploaded PDFs or covers on VPS disk.

Use Cloudflare R2 for media storage.

Do not replace SQLite with another database during unrelated work.

Do not replace Knex with another ORM.

Do not introduce Docker, Kubernetes, microservices, Redis, queues, or additional infrastructure without a concrete requirement.

Do not merge frontend and backend deployment flows.

Frontend production deployment belongs to Azure Static Web Apps.

Backend production deployment belongs to the VPS.

Backend port 3000 is reserved for the Express API.

Do not use port 3101 for the application; it is reserved for Hermes-related infrastructure.

## Repository Navigation

Before changing code, inspect only the relevant execution path.

For frontend work, begin in `frontend/`.

For backend/API work, begin in `backend/`.

For schema changes, inspect:
- database/migrations/
- knexfile.js
- backend/models/db.js

For production backend deployment, inspect:
- .github/workflows/deploy-backend.yml
- scripts/deploy.sh
- nginx/ucup-edu-lib.conf

For frontend deployment, inspect the Azure Static Web Apps workflow.

Do not perform repository-wide analysis for ordinary tasks.

## Execution Protocol

For normal tasks:

understand → inspect → implement → validate → report

For bugs:

reproduce or establish evidence → trace execution path → identify root cause → fix → verify

For features:

understand existing patterns → implement smallest coherent change → test affected behavior → build when appropriate

Never claim something works unless it was actually verified.

## Scope Control

Keep ordinary changes local to the requested feature or bug.

Do not combine unrelated refactors with feature work.

Do not clean up unrelated files merely because they could be improved.

Do not rename APIs, database columns, routes, or public interfaces without checking all consumers.

Large refactors, architecture changes, repository-wide audits, dependency upgrades, and migrations require explicit user intent.

## Validation

Use the cheapest relevant validation first.

Backend changes should normally consider:
- syntax validation
- affected tests
- npm test when appropriate

Frontend changes should normally consider:
- lint
- production build
- affected behavior

Database changes should validate migrations and compatibility.

Deployment-related changes require extra caution.

## Production Safety

Production systems are high-impact.

Reading production status, logs, configuration, and health information is safe and may be done proactively when relevant.

Do not perform destructive or difficult-to-reverse production actions without explicit user intent.

Be especially careful with:
- database modifications
- database restoration
- firewall configuration
- SSH configuration
- Nginx configuration
- TLS certificates
- PM2 process changes
- DNS
- Azure production configuration
- Git history rewriting

Never expose secrets or credentials.

Never commit `.env` files, tokens, passwords, private keys, or production credentials.

## Resource Constraints

The local development machine uses Linux Mint Cinnamon with 8 GB RAM.

Keep local workflows lightweight.

Avoid unnecessary Docker usage.

Avoid launching many heavy services simultaneously.

Prefer targeted tests over repeated full-suite execution while iterating.

Do not use expensive parallelism without benefit.

## Completion Standard

Before finishing:

confirm the requested behavior was addressed,
run appropriate validation,
remove temporary debugging artifacts,
check for obvious regressions,
and accurately report anything that remains unverified.