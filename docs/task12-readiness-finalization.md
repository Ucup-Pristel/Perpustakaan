# Task 12 migration readiness finalization

Validated 2026-11-17. Base: main `6a1de66d3cc9a3eb58ef6719ca0d17f58f9de8e0`.
Fix branch: `fix/task-12-migration-readiness`. No production systems or real data
were accessed; no deployment or merge was performed.

## Changes and root causes

- Restore frontend dependency installation, browser discovery, lint and build in
  the existing GitHub Actions gate. Include frontend changes in its path filters.
  Preserve PostgreSQL, backend, dependency audit and Docker recovery checks.
- Hero, Library and Reader now reject missing browser/dependency prerequisites
  when `CI` is set instead of silently skipping. Local backend-only runs retain
  their optional skips. Run the complete suite sequentially in CI to avoid
  competing browser/PDF processes and migration workers on limited runner CPUs.
- Fix the Library test's setup: at 768px its category strip was 705px wide with
  705px of content, so an overflow arrow correctly did not exist. Retain tablet
  geometry assertions, then resize to 640px and require real overflow before
  testing both arrow directions. No assertion was removed.
- Run the Reader's rapid-scroll gesture inside the browser. Repeated CDP calls
  under concurrent load made nominal 50ms pauses long enough to settle on an
  intermediate page. Preserve the exact final-page-only request assertion and
  all timeouts. No application behavior was changed.
- Separate runbook 4a (fresh empty installation) from 4b (SQLite import). Before
  import restore, even `migrate-prod status` must be avoided on the final database
  because Knex can initialize bookkeeping tables. Add a rehearsal assertion that
  restore refuses a target containing only that metadata.
- Correct the post-import cross-reference to relocation steps 8–12 only; the
  previous steps 4–12 reference would reset the destination just restored.
  Document target checks, stopping writers, retained recovery evidence, and
  operational cutover acceptance in `infra/README-portable.md` section 10.
- Limit Azure **PR preview** triggers to `frontend/**` so this infrastructure/test
  PR cannot deploy a preview. No Azure service settings were accessed. The main
  push trigger is unchanged: merging a workflow change can still trigger its
  existing Azure deployment and requires separate deployment authorization.

## Executed validation

| Check | Result |
| --- | --- |
| Full suite, Node 22, `CI=true`, actual Chromium, local PostgreSQL 17, `--test-concurrency=1` | **161 passed, 0 failed, 0 skipped, 0 cancelled** |
| Backend with actual PostgreSQL, standalone run | 105 passed, 0 failed, 0 skipped; included in full-suite result |
| Hero / Library / Reader browser coverage | All executed in the full suite; no skip |
| Negative prerequisite checks | All three suites fail as expected with missing Chrome, and with missing frontend dependencies (6 expected failures verified) |
| Frontend lint | Exit 0; 11 existing warnings |
| Frontend production build | Passed; existing chunk-size warning |
| Backend production dependency audit | Zero reported vulnerabilities |
| Docker image build | Passed using a temporary Dockerfile with the cloud proxy CA mounted as a BuildKit secret; TLS verification remained enabled |
| Isolated Docker rehearsal | **42 checks passed**, including migrations/import, backup/checksum/restore, metadata-only target refusal, integrity, network isolation, readiness outage/recovery and synthetic TLS renewal |
| Changed JS/shell syntax, YAML parsing and whitespace | Passed |

Initial failures were investigated rather than waived: the Library setup assumed
overflow where there was none, and the unrestricted parallel suite exposed the
Reader gesture timing issue and exhausted its aggregate timeout. Final checks
above supersede those failing diagnostic runs; assertions/timeouts remain intact.

Logs and synthetic screenshots are retained outside Git in
`/workspace/task12-finalization-evidence/`, notably `full-tests-final.log`,
`browser-guard.log`, `rehearsal.log`, `docker-build.log`, `lint.log`, `build.log`,
`audit.json`, and `library-before/` / `library-after/`.

## Not executed / operational prerequisites

GitHub API access returned `Forbidden` in this cloud environment. Remote PR/CI
status must be checked separately; local passing tests are not remote CI evidence.

Production readiness still requires encrypted offsite backup provisioning and a
download/decrypt/restore drill, agreed RPO/RTO, real TLS issuance/renewal and expiry
monitoring, provider firewall/IPv4/IPv6 verification, protected secrets and GitHub
environments, an approved write freeze and rollback plan, and pre/post-cutover
data/application verification. R2/email tests against real services require
separate authorization. No such operational action was performed here.

Repository validation passes locally. Production deployment remains NO-GO until
those operational prerequisites and explicit cutover authorization are satisfied.
