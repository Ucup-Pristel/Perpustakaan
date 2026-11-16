# Task 12 validation and consolidation gate

Validation date: 2026-11-16 UTC. All database and Docker exercises used isolated,
synthetic local data. No production service, database, DNS, VPS, credential or
deployment was accessed. The separate Task 13 checkout remains untouched.

## Repository state and verdict

- Main baseline and final unchanged main SHA:
  `343dcefea227a7506ac7ce2e737d16ac209919c9`.
- Starting infrastructure HEAD: `a05c1d7d841408da7e7346a30c9277175a9c8e03`.
- Work continues on `agent/portable-deploy-5f2-security`, preserving ancestry.
- **Repository merge readiness: NO-GO.** Browser Reader regressions fail, and
  cloud network policy blocks `api.github.com`, preventing verification of
  GitHub CI conclusions and branch protection. No merge or branch deletion.
- **Production deployment readiness: NO-GO.** Passing local infrastructure
  checks is insufficient for cutover; operational prerequisites remain below.

The previous audit's full findings were not present in the repository. Its
user-supplied CONDITIONAL PASS / production NO-GO verdict was treated as context,
not as proof of any unobserved test result.

## Defects corrected

1. `/api/health` only proved that Express was alive. Compose could report healthy
   before migrations or with an unavailable database. Added read-only
   `/api/ready`: recorded migrations must exactly match the release and the
   migration lock must be clear. Database failures return generic 503 responses;
   responses are not cached. Query/acquisition deadlines bound failures.
   Liveness remains separate; probes never initialize metadata or migrate.
2. PostgreSQL's old `pg_isready` probe accepted a server whose first-init script
   had failed and whose application role did not exist. Health now authenticates
   over TCP as the application role and queries the application database.
3. The cloud shell's umask 077 produced unreadable bind-mounted init scripts and
   root-owned image source. The runtime image explicitly grants read/traverse
   access to public code, retaining root ownership and non-root execution.
   The runbook documents the init script's required read/execute permissions.
4. Init/import examples passed database passwords in process arguments despite
   claiming otherwise. `psql` now uses `\getenv`; Docker receives variable names,
   not expanded values. Environment inspection remains possible for Docker
   administrators, so daemon access must be restricted.
5. Backup verification trusted the filename inside a sidecar checksum. A valid
   checksum for another file could pass while the requested archive was changed.
   Verification now hashes the requested archive and compares its digest with
   one validated sidecar digest. Checksums establish integrity, not authenticity
   against an attacker who controls both the archive and digest.
6. Concurrent backup jobs could share/overwrite a same-second partial archive.
   A non-blocking per-database/directory `flock` now serializes backup publication;
   retention input is validated before writing/deleting backups.
7. CI previously allowed real PostgreSQL imports and browser tests to skip when
   their prerequisites were absent. It now provisions ephemeral PostgreSQL,
   installs frontend dependencies, requires a browser, runs lint/build and the
   full tests, audits dependencies, then builds and runs the Docker rehearsal.
   Failing tests still block deployment. No automatic deployment was added.
8. Editing the historical baseline migration only fixed fresh PostgreSQL
   databases. A new, idempotent forward migration repairs missing catalog indexes
   in databases that already recorded the old baseline. A real PostgreSQL test
   simulates that upgrade and verifies that only the new migration runs. Its
   rollback preserves indexes that may have existed before the repair.

## Validation evidence

Logs are retained outside Git in `/workspace/task12-evidence/`; synthetic
credentials are not committed. Results overlap; do not add their test counts.

| Check | Observed result |
| --- | --- |
| Node 22 dependency installation | Backend and frontend `npm ci` passed |
| Backend suite with local PostgreSQL | 105 passed, 0 failed, 0 skipped after the forward migration (`backend-upgrade-final.log`) |
| Extended real PostgreSQL/import suite | 10 passed, 0 failed, 0 skipped (`pg-migration-final.log`); includes real readiness, indexes, legacy cover migration/conflict rollback; the final forward-upgrade assertion also passed in `backend-upgrade-final.log` |
| Readiness/API focused tests | 13 passed (`readiness-api.log`) |
| Frontend regressions | 11 passed, 5 failed, 2 cancelled (`frontend-regression.log`) |
| Frontend lint | Exit 0, seven existing warnings |
| Frontend production build | Passed; existing large-chunk warning |
| Production dependency audits | Backend and frontend: zero reported vulnerabilities; this is not an OS-image vulnerability scan |
| JavaScript / shell syntax and whitespace | Passed |
| Compose / YAML | Staging `docker compose config --quiet` passed with template values; both Compose files and backend workflow parsed successfully; production config exercised in rehearsal |
| Docker image build | Passed with the cloud proxy CA mounted as a BuildKit secret in a temporary Dockerfile; TLS verification stayed enabled and the CA was not baked into the runtime image |
| Isolated Docker disaster recovery | 41 checks passed on the final code and five migrations (`rehearsal-upgrade-final.log`), including local TLS renewal/trust verification and database outage/recovery |

The ordinary Docker build initially failed at npm HTTPS access. Using the
documented cloud-runtime CA mechanism resolved it. Build adaptation exists only
in `/workspace/task12-evidence/Dockerfile.api.session`; deployment must build the
repository Dockerfile in the target's approved build environment.

Frontend failure: Reader browser tests time out waiting for PDF wrappers/canvases,
and PDF.js reports a null `sendWithPromise` transport during page measurement.
The frontend source, lockfile, Reader test and Azure workflow match main exactly;
this is a baseline failure, not an infrastructure frontend change. Repair and
validation belong to the concurrent frontend workstream; the failure is not
waived or hidden.

## Merge and deployment safeguards

The backend deployment job requires all three conditions: `workflow_dispatch`,
`refs/heads/main`, and the exact `deploy legacy pm2` input; it also needs the test
job. A push/merge or pull request cannot satisfy that deployment condition.
The infrastructure diff changes neither `frontend/**` nor the Azure workflow,
so its normal main push does not match Azure's production deployment path filter.
Azure does create previews for main-targeting pull requests; no PR was opened.

This is a static workflow review. GitHub API requests for main protection and
commit check-runs returned `Forbidden`; the environment's enforced allowlist
omits `api.github.com`. No network restriction or branch protection was bypassed.
Before consolidation, obtain actual CI/protection status, rerun acceptance tests
on the current merge candidate, and recheck remote main and changed paths.

## Retained branches

No branches were deleted. All nine preceding infrastructure tips were verified
as ancestors of the starting infrastructure HEAD. They are not yet reachable
from main, so deletion is not authorized by the reachability gate:

- `feat/docker-postgresql-infra`
- `agent/pg-compat-4e2-drop-cover`
- `agent/pg-compat-4e2-indexes`
- `agent/pg-compat-4e2-inserts`
- `agent/pg-compat-4e2-booleans`
- `agent/pg-compat-4e2-search`
- `agent/pg-compat-4e3-readiness`
- `agent/pg-compat-4e4-importer`
- `agent/portable-deploy-5f1-packaging`

Also retained: `agent/portable-deploy-5f2-security`, `main`, and
`feat/task-13-landing-page` at `c516c85f4f19e73095d38ffc39151ba08cfc684b`.
No Task 14 or 14.1 refs were advertised by origin during this audit; neither
workstream was touched. Use an ordinary ancestry-preserving merge after all
gates pass, then verify each obsolete tip is reachable from main before deleting.

## Remaining production-only prerequisites

- Configure encrypted offsite backups outside the VPS/provider account, separate
  least-privilege credentials and recovery keys, 14 daily/8 weekly retention,
  failure alerts, and an actual download/decrypt/verify/restore drill. The repo
  documents this requirement but does not implement an offsite transfer service.
- Set approved RPO/RTO and measure restore on representative volume sizes. Local
  synthetic timings do not establish production recovery objectives. Current
  importer/report routines load table data into memory and need sizing checks.
- Configure `legacy-production` required reviewers, main-only access and scoped
  secrets. Confirm branch protection and green CI without bypassing checks.
- Establish controlled secret provisioning/rotation and Docker administrator
  access. Preserve session-signing continuity where intended. No real secret
  was read or tested here.
- Validate real TLS issuance, renewal timer/deploy-hook and certificate expiry
  monitoring; local self-signed certificate renewal/hook/trust checks and ACME routing do not verify actual certificate authority issuance or production scheduling.
- Verify provider firewall, public port exposure, IPv4/IPv6 and DNS plan on the
  approved target. Do not change DNS until separately authorized.
- Approve and scan immutable release images, retain previous images/backups,
  arrange monitoring and capacity checks, and test actual R2/email integrations
  only under separate production authorization.
- Rehearse the write freeze and rollback decision: after new PostgreSQL writes,
  the old SQLite database is stale. PostgreSQL dumps cannot be restored directly
  into SQLite. There is no reverse importer or automatic data merge; a rollback
  after writes needs an explicit reconciliation/data-loss decision. For later
  PostgreSQL-to-PostgreSQL moves, preserve a single writer and follow the guarded
  reverse restore process. A schema rollback can lose post-backup writes.

Raw evidence: `backend-upgrade-final.log`, `frontend-regression.log`,
`frontend-lint.log`, `frontend-build.log`, `audit-initial.json`,
`frontend-audit.json`, `docker-build-upgrade.log`, and
`rehearsal-upgrade-final.log` under `/workspace/task12-evidence/`.

No production rollout is authorized by this validation report.
