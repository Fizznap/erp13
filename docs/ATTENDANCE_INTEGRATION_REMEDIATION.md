# Attendance and integration-test follow-up

**Date:** 2026-10-28  
**Scope:** local source, mocked regression tests, isolated local PostgreSQL/pgvector and Redis tests, and one synthetic live Gemini embedding attempt. No production database, account, uploaded resource, deployment, or production configuration was accessed or changed.

## Current verification addendum (2026-10-28)

The current verification supersedes earlier test counts and blockers below. It ran 88 backend unit tests, 7 isolated local PostgreSQL/Redis integration tests, and the frontend tests/build/type check. The local database identity was checked as `snippet_test|snippet_test_user` before the test run. The `snippet-remediation` services were stopped afterward; their volumes were preserved. The production dependency audit now reports zero vulnerabilities. No commit, push, deployment, production query, or production data change occurred.

Attendance integration now exercises successful student marking, duplicate submission, expired nonce, invalid nonce, reuse of a nonce against another session, class and lab-group denial, authorized faculty correction, unauthorized faculty/class/lab correction, and student history after a correction. Photo upload/read persistence is tested with synthetic PNG signature bytes in the existing PostgreSQL `user_avatars` table. The integration suite also tests class-scoped pgvector retrieval and tests that Ask Snippet passes only the question and retrieved chunks to generation. Invalid citation references and the exact unsupported-answer fallback remain covered by mocked route tests.

The local configured Gemini key was present and matched the value parsed from `S:\ERP\server\.env`; the diagnostic process had no inherited User/Machine or parent-process key. The synthetic `gemini-embedding-2` request returned HTTP 401 with Google status `UNAUTHENTICATED`, reason `ACCESS_TOKEN_TYPE_UNSUPPORTED`, and a sanitized message that the API key was invalid. Request host/path, header, model and dimensions were verified in memory; the credential itself was never printed. This reason points most strongly to an unsupported key/credential type, but key status, project association and restrictions were not independently verified in Google AI Studio. Owner action: visit [Google AI Studio API keys](https://aistudio.google.com/api-keys), verify status/type and associated project, and confirm Generative Language API access. Prefer an active Authorization API key or a Standard key with currently supported restrictions, then replace only the local `GOOGLE_AI_API_KEY` through the existing secret mechanism. Do not paste the value into chat. Google documents the required header and key restrictions in the [Gemini API reference](https://ai.google.dev/api) and [API key guide](https://ai.google.dev/gemini-api/docs/api-key?hl=en). No successful live provider call or latency sample was obtained.

The generation model now resolves locally to `gemini-3.1-flash-lite` through `GOOGLE_AI_MODEL`; both provider paths retain environment overrides. The ignored `server/.env` was updated in place without printing its contents. The embedding model remains `gemini-embedding-2` with 768 dimensions. No embeddings were regenerated. The Render blueprint still sets the earlier generation model and was intentionally not changed or deployed. [Gemini 3.1 Flash-Lite model](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)

Final checks: backend unit 88 passed; local database/Redis integration 7 passed; frontend 17 passed; client production build and TypeScript check passed; targeted ESLint passed; full client ESLint remains at 7,312 findings (7,302 errors, 10 warnings); `npm audit --omit=dev` returned 0 vulnerabilities. Browser end-to-end and production checks were not run.

## Attendance-history defect and fix

Previously, `GET /api/attendance/my/records` started from `attendance_records`. A student with no row for a class session therefore had no history entry; the frontend used returned rows as the denominator and overstated attendance.

The route now starts from `attendance_sessions` and includes only sessions with `is_active = false` and a non-null `ended_at`. It applies the same branch/batch/division and lab-group eligibility used by the attendance marking flow. For legacy sessions without an offering, it honors the existing same-class offering or `subject_enrollments` fallback. It excludes rows for inactive, unverified, non-student, or unassigned users. No cancellation field or cancellation route exists in the schema, so cancellation cannot be independently distinguished; unended/active sessions are excluded.

Attendance is attached with a `LEFT JOIN LATERAL`, so an eligible session without a row is still returned. `present` remains present; explicit `absent`, `rejected`, and a missing row are returned as `absent` for percentage calculation. The query orders possible duplicate records by `marked_at` and ID and takes only one. The schema also has `UNIQUE(session_id, student_id)`. The frontend deduplicates session IDs as defense in depth, aggregates by subject ID, and returns zero safely for an empty history.

No database migration was needed. The current response still exposes `session_id`, `subject_id`, `subject_name`, `session_date`, and `status`, preserving the existing attendance page contract while adding session IDs and explicit absence rows.

## Automated verification

### Latest local integration pass (2026-10-28)

Docker became available after the initial audit. I created an isolated Compose project named `snippet-remediation` with only PostgreSQL/pgvector and Redis services, verified its project/service labels and database identity, initialized the dedicated `snippet_test` database, and ran the opt-in integration suite. No production URL was used. The integration fixtures were synthetic and scoped cleanup removed their rows and uploaded test PDFs.

| Command | Result | Test scope |
|---|---|---|
| `RUN_LOCAL_DB_INTEGRATION=1 npm test -- --runInBand --detectOpenHandles tests/integration/local-postgres-worker.integration.test.js` (`server`, test-only local DB/Redis env) | 1 suite, 7 tests passed; no open handles reported | Real PostgreSQL attendance mark/history/corrections/authorization/photo persistence; API PDF upload; standalone Bull worker; extraction; local fake Gemini; pgvector persistence and class-scoped retrieval; protected download; provider retry/failure status |
| `npm test -- --runInBand` (`server`) | 16 suites, 86 passed; 1 opt-in suite skipped by default | Unit and mocked route suite |
| `npm test -- --run` (`client`) | 3 files, 17 tests passed | Client unit tests |
| `npm run build` (`client`) | Passed | Production build |
| `npx tsc --noEmit` (`client`) | Passed | TypeScript check |
| `npx eslint src/lib/attendance.ts src/test/attendance-history.test.ts` (`client`) | Passed | Targeted lint |
| `npm run lint` (`client`) | Failed: 7,312 problems (7,302 errors, 10 warnings) | Pre-existing project-wide formatting/type-rule backlog; not bulk-formatted |

The integration API queue was configured as producer-only. Worker logs confirmed the standalone worker consumed the queued resource jobs. The success path persisted extracted chunks with 768-dimensional vectors; the failure path retried the deterministic local provider failure and marked the resource failed without storing successful chunks. The database integration also exposed and fixed an alias error in the resource list SQL. A PDF.js Buffer-offset incompatibility was fixed by copying input bytes to `Uint8Array`.

The fake Gemini service only verifies request/data flow and deterministic failure behavior. The live Gemini request after switching to the documented auth header still returned HTTP **401**; real Google embeddings/generation remain unverified.

Commands run from `S:\ERP\server` and `S:\ERP\client`:

| Command | Result | Test scope |
|---|---|---|
| `npm test -- --runInBand` | 16 suites, 86 tests passed; opt-in DB suite skipped by default | Final unit/mocked verification; use the opt-in command above for real local database coverage |
| `npm test -- --run` | 3 files, 17 tests passed | Client unit tests, including present, mixed/absent, duplicate, and empty histories |
| `npm run build` | Passed | Client production build |
| `npx tsc --noEmit` | Passed | Client type check |
| `npx eslint src/lib/attendance.ts src/test/attendance-history.test.ts` | Passed | Newly added frontend helper and test only |
| `npm run lint` | Failed: 7,312 findings (7,302 errors, 10 warnings) | Existing project-wide formatting/type lint backlog; existing dirty files were not bulk-formatted |
| `docker compose config --quiet` | Passed with obsolete `version` warning | Configuration parsing only |
| `docker compose -p snippet-remediation ps` (before stop) | Dedicated `db` and `redis` were healthy | Existing `erp` project was left untouched; test services are now stopped and their named volumes preserved |

The unit history tests inspect SQL and mock `pool.query`; the separate seven-case integration suite executed attendance/history SQL and uniqueness constraints against PostgreSQL. Only synthetic fixture rows were used and cleaned up. No existing or production attendance rows were queried or modified.

## Database and worker integration blocker

At the initial audit Docker Desktop's Linux engine endpoint `//./pipe/dockerDesktopLinuxEngine` was unavailable, so no database tests ran then. In the later follow-up Docker became available. Only the separately named `snippet-remediation` Compose project was started, with dedicated volumes and the `snippet_test` database; the production `DATABASE_URL` and the existing `erp` project were not used or changed. The verified setup and later test results are recorded above.

The app's `server/src/db/init.js` initializes in this order: `server/src/db/schema.sql`, migrations `migration_02_student_profiles.sql` through `migration_05_password_reset_tokens.sql`, then additive resource-column/index setup. The existing schema and migrations were already initialized in the disposable `snippet_test` database; this latest run made no schema changes. The opt-in suite covers synthetic attendance marking/history/correction, photo persistence, upload, queue processing, and resource/vector class authorization. It does not cover every production workflow or live Gemini. `server/src/index.js` also calls `initQueue()` and registers a processor, so API and standalone worker processes can both consume the Bull queue; test logs confirmed the standalone worker handled the synthetic jobs.

### Repeatable isolated-service setup

Start Docker Desktop with the Linux engine, then in PowerShell from `S:\ERP` set values for a dedicated test-only Compose project (not the production `DATABASE_URL`):

```powershell
$env:POSTGRES_USER = 'snippet_test_user'
$env:POSTGRES_PASSWORD = 'replace-with-a-random-local-only-password'
$env:POSTGRES_DB = 'snippet_test'
docker compose -p snippet-remediation up -d db redis

$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgres://snippet_test_user:replace-with-a-random-local-only-password@localhost:5432/snippet_test'
$env:REDIS_URL = 'redis://localhost:6379'
$env:UPLOAD_DIR = Join-Path $env:TEMP 'snippet-remediation-uploads'
Push-Location .\server
npm run db:init
```

The Compose project name creates separate named volumes from the default project; do not use `down -v`. Replace the example password with a generated random local-only value. The integration test refuses any target other than local port 5432, database `snippet_test`, user `snippet_test_user`. This setup was executed for local testing. Its two services were stopped after checks with `docker compose -p snippet-remediation stop db redis`; the volumes were intentionally preserved. The integration suite starts a standalone worker as a child process and cleans only its own fixture records/files.

## Gemini model and live-provider result

`server/src/services/rag.js` uses the Gemini REST `embedContent`, `batchEmbedContents`, and `generateContent` endpoints. The embedding model is `gemini-embedding-2` with `outputDimensionality: 768`, matching PostgreSQL `vector(768)`. The API key is configured in the local server environment, but its value was not printed or copied.

Google's current documentation says `gemini-3.5-flash` is deprecated and automatically routed to `gemini-3.6-flash`. It also says `temperature`, `top_p`, and `top_k` are ignored/deprecated for Gemini 3.6 and future releases. The local defaults now use `gemini-3.6-flash` (overridable through `GOOGLE_AI_MODEL`), omit `temperature`, and apply a 30-second provider request timeout (`GOOGLE_AI_TIMEOUT_MS` can override it). The code still uses the supported legacy Generate Content REST API; Google's documentation now recommends the Interactions API for new integrations. A full migration is left for a separately tested change.

One direct synthetic embedding request was attempted before the auth header change and returned HTTP **401**. A second one-request probe after the code change to `x-goog-api-key` also returned HTTP **401**. This indicates the configured credential is rejected for this request, but does not identify whether it is invalid, disabled, unrestricted, attached to a different project, or missing API access. No key or response body was exposed. Thus:

| Check | Evidence/status |
|---|---|
| Real embedding generation and dimensions | Blocked by HTTP 401; 768 dimension contract is covered by mocked tests and source/schema inspection |
| pgvector persistence and retrieval | Mock Gemini provider + real isolated PostgreSQL retrieval/class-scope integration passed; live Google embedding remains blocked |
| Real answer, citation grounding, unsupported-answer fallback | Blocked by HTTP 401 and no database retrieval |
| Provider HTTP failure and timeout propagation | Mocked unit tests pass; no real provider timeout was induced |
| Latency | No successful provider call; no latency distribution can be reported |

Official documentation reviewed: [Gemini API reference and required `x-goog-api-key` header](https://ai.google.dev/api), [API key restrictions and authorization keys](https://ai.google.dev/gemini-api/docs/api-key?hl=en), [Gemini 3.6 Flash model](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), and [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings).

## Security-fix review

The previous local security fixes remain present and their regression tests passed in the backend unit suite and relevant database integration checks: Render no longer runs demo cleanup/seeding at startup; direct `/uploads` access is admin-only; uploaded PDFs are signature-checked; embedding failures do not produce a ready resource; generated citations are range-checked; attendance coordinates/radius are validated; internal server errors are hidden from clients; `/api/health/db` is rate-limited; resource downloads retain authorization checks; Face ID remains disabled; and refresh-token revocation code remains present. Gemini API keys are sent in the documented header and provider error bodies are not reflected in exceptions. The auth limiter is applied to registration, email/password login, Google login, verification, refresh, password reset and avatar upload; rate limits are in-memory per process, so distributed throttling remains a deployment concern. The final production dependency graph has zero audit findings: body-parser is patched at 1.20.9, qs is 6.16.2, and uuid is 11.1.1 (including Bull's nested UUID through a tested override); see the dependency table in `PROJECT_AUDIT_REPORT.md`. Access tokens are short-lived and refresh tokens are revocable, but the frontend currently stores tokens in local storage rather than secure HTTP-only cookies. Resource and attendance role/class/session authorization was exercised with synthetic PostgreSQL records. These are local-source/test findings, not production verification.

The 30-second Gemini timeout was added in this follow-up. Existing risks remain: GPS coordinates can be spoofed, rate limits are process-local, JWTs are held in browser local storage, and Render resource files use ephemeral local storage until a separate approved object-storage migration.

## Files changed in this follow-up

- `server/src/routes/attendance.js` - return eligible completed sessions and absent rows, including no-row sessions; choose one record per session.
- `client/src/routes/_authenticated/attendance.tsx` - base the history UI and totals on unique session rows.
- `client/src/lib/attendance.ts` - share duplicate-safe history aggregation and empty-history handling.
- `server/src/services/rag.js`, `server/src/services/llmAdapter.js` - supported models, request timeout, documented Gemini key header, and sanitized provider errors.
- `server/tests/attendance-history.test.js`, `server/tests/rag-provider.test.js`, `server/tests/llm-google-provider.test.js`, `server/tests/ask-llm.integration.test.js`, `client/src/test/attendance-history.test.ts` - regression coverage.
- `docs/PROJECT_AUDIT_REPORT.md` - updated status and test counts.
- `docs/ATTENDANCE_INTEGRATION_REMEDIATION.md` - this follow-up report.

## Current integration follow-up changes

- `server/tests/integration/local-postgres-worker.integration.test.js` - opt-in tests guarded by `RUN_LOCAL_DB_INTEGRATION=1`; refuses targets other than local port 5432, database `snippet_test`, user `snippet_test_user`. Uses fixture-scoped cleanup and a test-only Gemini HTTP stand-in; now covers attendance marking/correction/expiry/replay/duplicates, class/lab isolation, profile-photo persistence, and vector retrieval scope.
- `server/package.json`, `server/package-lock.json` - compatible updates to body-parser, qs, and uuid, plus a patched uuid override under Bull; `npm audit --omit=dev` reports 0 vulnerabilities.
- `server/src/jobs/queue.js` - supports producer-only initialization for an API process in tests while preserving default production behavior.
- `server/src/services/rag.js` - permits a localhost-only provider base URL override only under `NODE_ENV=test`.
- `server/src/services/processor.js` - copies PDF bytes to `Uint8Array` to avoid bundled PDF.js Buffer backing-store offset parsing errors.
- `server/src/routes/resources.js` - aliases the resources table so the existing resource authorization scope SQL resolves correctly.
- `server/package.json`, `server/package-lock.json` - adds PDFKit as a development-only PDF fixture generator.

## Git and deployment state

Both repositories remain on `main` with local uncommitted changes. The parent repository and nested frontend already contained unrelated uncommitted edits; these were preserved. No commit, push, deployment, production query, production data change, or upload-volume operation occurred. The Render startup change still requires review before a future authorized deployment.

## Remaining work

1. The owner should verify the Gemini API key in Google AI Studio / its Google Cloud project: use an active key with Generative Language API access and the required key restriction or an authorization key. Supply the corrected value through the existing local/server secret mechanism; do not paste it into chat. Then rerun live embeddings, generation, citation/fallback, retry/timeout, and measured latency checks.
2. Browser end-to-end and production verification remain outstanding. Do not infer production readiness from these local tests.
3. A contained Interactions API migration can be assessed separately after the current Generate Content integration succeeds.
4. Review the complete local diff before any future commit or deployment. This task did not authorize either action.
