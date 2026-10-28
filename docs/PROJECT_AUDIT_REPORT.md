# Snippet project audit and remediation report

**Audit date:** 2026-10-28  
**Scope:** local source and available automated checks. No production database was queried or changed; no production deployment was performed.

**Follow-up:** Attendance history, local PostgreSQL/Redis and worker integration results are recorded in [ATTENDANCE_INTEGRATION_REMEDIATION.md](ATTENDANCE_INTEGRATION_REMEDIATION.md). That follow-up supersedes the initial Docker/database blocker and earlier attendance-history notes below.

## A. Executive summary

The repository contains a real React/TanStack application and an Express/PostgreSQL API, with Redis/Bull and Gemini integrations. The most important issues found were a Render startup command that runs demo cleanup and account seeding on every service start, an unauthenticated static upload path, insufficient validation of attendance coordinates, embeddings failures being reported as successful indexing, and LLM citation numbers not being checked against retrieved chunks. These issues were corrected locally with regression tests. Changes remain uncommitted and unpublished because this audit explicitly forbids deployment.

The latest backend unit suite passed 88 tests; the isolated PostgreSQL/pgvector + Redis integration suite passed 7/7. The local generation model is now `gemini-3.1-flash-lite`; embedding remains `gemini-embedding-2` with 768 dimensions. Frontend tests (17), build, type check, and targeted lint passed. The production dependency graph is now clean (`npm audit --omit=dev`: 0 vulnerabilities). Full frontend lint still has its previously measured 7,312 findings. Gemini requests use Google's documented `x-goog-api-key` header and redact provider response bodies, but the last live synthetic embedding request returned HTTP 401 with `ACCESS_TOKEN_TYPE_UNSUPPORTED`. Mock-provider tests do not verify live Gemini behavior. SMTP, browser end-to-end, and production behavior were not exercised; no production systems were changed.

## Repository state recorded before changes

- Parent repository: `main`, `7c36204`; working tree clean.
- Nested frontend repository: `main`, `40d9254`; already had many uncommitted tracked and untracked changes, including `.env`, package files, route files, and components. Those changes were preserved and not staged.
- No `.env` values were copied into this report or tool output. The tracked frontend `.env` variable names inspected were public client configuration names (Google client ID and Supabase URL/project/publishable key); values were not inspected or reported.

## B. Feature status matrix

| Feature | Frontend | Backend | Database / external | Test evidence | Actual status | Severity / limitation |
|---|---|---|---|---|---|---|
| Email registration and verification | Registration form calls Express API | Domain check, password hashing, verification token and SMTP path present | PostgreSQL users table; SMTP required for email delivery | Backend auth/domain tests pass; mocked DB | IMPLEMENTED BUT UNVERIFIED | No live SMTP or DB test; non-college existing accounts were not enumerated |
| Email/password login and refresh/logout | JWTs stored in browser localStorage; refresh retry and logout request | Password compare, DB-backed eligibility, refresh-token revocation | PostgreSQL; JWT secret required | Auth tests pass with mocked dependencies | IMPLEMENTED BUT UNVERIFIED | XSS can expose localStorage tokens; no production session test; auth throttling is process-local |
| Google sign-in | Google Identity Services button appears only when `VITE_GOOGLE_CLIENT_ID` is present | Google library verifies token; exact domain, verified email and `hd` are required | `GOOGLE_CLIENT_ID` must match the frontend client | Google identity unit tests pass; no real token/provider call | IMPLEMENTED BUT UNVERIFIED | OAuth console and production secrets were not tested |
| Role enforcement | Role-aware routes and controls | Role loaded from DB on each authenticated request; server middleware gates admin/faculty/student routes | PostgreSQL is authoritative | Middleware/route tests, mostly mocked | IMPLEMENTED BUT UNVERIFIED | No two-user real DB class-isolation run |
| Academic branches/classes/lab groups | Onboarding and admin selectors | Hierarchy and class-assignment APIs; class and lab-group checks in attendance | PostgreSQL hierarchy tables and idempotent migrations | Migration setup and attendance eligibility ran against isolated PostgreSQL | IMPLEMENTED BUT UNVERIFIED | Production records and full onboarding/admin lifecycle were not tested |
| Resource upload and processing | Upload/status/download UI calls API | Multer upload, PDF extraction, chunking, embeddings, metadata, Bull queue and retry path | Local disk plus PostgreSQL, Redis, Gemini | Real local upload/worker/pgvector path passed with deterministic provider | PARTIALLY WORKING | Live Gemini remains HTTP 401; Render filesystem is ephemeral |
| Resource download and authorization | Download through authenticated API route | Per-resource access check for student class, faculty ownership, or admin | File path in DB | Local integration checks owner/class download and protected static path | PARTIALLY WORKING | Public static bypass fix is not deployed; production access is unverified |
| Ask Snippet / RAG | Ask page calls API and displays returned sources | Class/subject-scoped vector search, threshold fallback, generation and audit log | pgvector and Gemini | Mocked route checks invalid citations/fallback and chunk-only prompt; real DB vector retrieval tested for class scoping | PARTIALLY WORKING | Live Gemini 401 (`ACCESS_TOKEN_TYPE_UNSUPPORTED`) blocks provider verification |
| Attendance marking | Student enters nonce; browser requests geolocation | Session/nonce, class/lab membership, duplicate record and radius checks | PostgreSQL session and record tables | Local DB exercised valid mark, expiry, nonce replay/invalid nonce, duplicate, cross-class and cross-lab checks | PARTIALLY WORKING | GPS coordinates can be spoofed; no browser/production run |
| Faculty attendance roster/correction | Present/absent roster and correction controls | Faculty ownership, division/lab-group scope, manual updates | PostgreSQL attendance records | Real DB tests cover owner, other faculty, class/lab scope and history consistency | IMPLEMENTED BUT UNVERIFIED | Synthetic fixtures only; no production-class test |
| Student attendance history/statistics | Computes totals and percentages from unique session rows | Returns completed eligible sessions; missing/rejected/explicit absent records count absent | PostgreSQL attendance sessions, records, class, offerings, and lab-group membership | Local PostgreSQL integration plus client summary tests | PARTIALLY WORKING | Broader browser and live-class checks remain outstanding |
| Student ID verification QR | `/verify/$studentNo` page | No public verification endpoint in Express; page query returns `null` | No data lookup | Code inspection | BROKEN | Public identity fields need an explicit privacy decision before exposing an endpoint |
| Profile photo | Upload/remove UI | Authenticated photo endpoints; Postgres `user_avatars` persistence | PostgreSQL BYTEA | Synthetic image bytes persisted and read through authenticated API against local PostgreSQL | IMPLEMENTED BUT UNVERIFIED | Synthetic fixture only; not a browser or production test |
| Reminders | Static empty-state page | No reminder API or persistence found | None | Code inspection | NOT IMPLEMENTED | Page currently says no reminders have been published, but no publishing flow exists |
| Attendance planning AI | Component renders `null`; helper functions are empty stubs | No corresponding Express endpoint | None | Code inspection | NOT IMPLEMENTED | Do not treat as a working feature |
| Face ID | Enrollment UI may exist | `/api/face/match` always returns `503` until real verification is added | None | Code inspection | NOT IMPLEMENTED (intentionally disabled) | Does not pretend to perform matching |
| Firebase analytics | Optional client analytics initializer | Firebase config returned only when env values exist | Analytics only; not authentication or data authority | Code inspection; not live tested | IMPLEMENTED BUT UNVERIFIED | Code points to project `snippet-9b16f`, different from the Firebase config previously supplied (`snippet-7668e`); measurement ID/config alignment is unresolved |
| Notifications / support | Sign-in support server function calls Lovable AI gateway | External server-side request with capped input | `LOVABLE_API_KEY` and external gateway | Not live tested | BLOCKED BY EXTERNAL DEPENDENCY | No claims about provider availability or cost behavior |
| Docker and background worker | Docker build is configured | API initializes Bull processing; Compose also starts a worker process | PostgreSQL, Redis, local shared uploads volume | Dedicated local PostgreSQL/Redis integration: upload and standalone worker job passed | PARTIALLY VERIFIED | Render runtime and production queue behavior were not changed or verified; live Gemini remains unavailable |

## C. Confirmed defects and local fixes

### P0 - Production startup could delete or rewrite records

`render.yaml` started the API with `db:cleanup:demo`, `db:seed:admin`, and `db:seed:students` on every restart. The cleanup deletes users and related records matching test/demo patterns. The admin seeder can change role, active/verified state, and password when configured. The roster seeder upserts student accounts and assigns roles. The Render command now runs only the idempotent schema initializer and API process. **This correction is local only; it has not been pushed or deployed.** No production data was touched.

### P1 - Uploaded PDFs could be fetched through a public static route

`/uploads` used `express.static` without authentication, bypassing `/api/resources/:id/download` authorization. It now uses a separate admin-authenticated router. A regression test creates a temporary fixture and proves unauthenticated requests receive `401`.

### P1 - Attendance accepted coordinates without numeric/range checks

The server checked only for null coordinates before calculating Haversine distance. It now requires finite numeric latitude/longitude within geographic ranges and limits faculty-configured radii to 1-"1000 meters. Route tests cover out-of-range and string inputs and verify they are rejected before database access.

### P1 - Embedding outages could mark a resource `ready`

The processor previously swallowed embedding failures, stored no vectors, and still marked the resource ready. It now propagates failures for Bull retries, validates vector count, finiteness, and 768-dimensional shape, and lets the outer handler mark the resource failed. Mocked tests cover provider failure and wrong dimensions.

### P1 - RAG accepted citations that did not exist in retrieved chunks

The answer route now checks citation references against the retrieved chunk range. Missing or out-of-range references return the exact `Not in provided material.` fallback with no sources. A mocked route test covers `[99]` when one chunk was retrieved.

### P2 - Error responses exposed implementation details

The generic Express error handler and upload, subject-offering, and academic-class handlers now return generic 500 messages instead of raw error text or stack traces. Server-side diagnostics remain logged.

### P2 - Database schema diagnostic bypassed the general limiter

`/api/health/db` was registered before the API limiter and ran several catalog queries per call. It now applies the API limiter directly. `/api/health` remains unthrottled for platform health checks.

## D. Test report

| Command | Result | Test type |
|---|---|---|
| `npm test -- --runInBand` (`server`) | 16 suites passed, 86 tests passed; opt-in integration suite skipped by default | Unit and mocked route tests |
| `RUN_LOCAL_DB_INTEGRATION=1 npm test -- --runInBand --detectOpenHandles tests/integration/local-postgres-worker.integration.test.js` | 1 suite, 7 tests passed; no open handles | Dedicated local PostgreSQL/pgvector, Redis, real API upload, standalone Bull worker, fake Gemini, attendance/auth/photo persistence and class authorization |
| `npm test -- --run` (`client`) | 3 files, 17 tests passed | Frontend tests with mocked fetch/router data |
| `npm run build` (`client`) | Passed | Vite/TanStack production build |
| `npx tsc --noEmit` (`client`) | Passed | TypeScript check |
| `npm audit --omit=dev` (`server`) | 0 vulnerabilities | Production dependency graph after compatible patch updates |
| `npm run lint` (`client`) | Failed: 7,312 problems (7,302 errors, 10 warnings) | Mostly Prettier quote/line-ending/formatting findings, plus type-rule errors; not bulk-fixed to avoid rewriting user changes |
| `docker compose config --quiet` | Passed with obsolete Compose `version` warning | Configuration parse only |
| Dedicated `snippet-remediation` DB init and `snippet_test` identity check | Passed; migrations 02-05 and vector setup initialized | Local isolated test database only; volumes preserved and services stopped after verification |

### Production dependency advisory follow-up

The installed server production graph is clean: `body-parser@1.20.9`, `qs@6.16.2`, and `uuid@11.1.1`; `bull@4.16.5` retains its existing major version with an npm override for its nested UUID dependency. The initial advisories were:

| Advisory | Original installed path / affected version | Assessment and resolution |
|---|---|---|
| [GHSA-27R3-JXMH-P828 / CVE-2026-111181](https://github.com/advisories/GHSA-27R3-JXMH-P828), high | `express@4.22.3 > body-parser@1.20.8` | Express globally parses unauthenticated request bodies with inflation enabled, so the crafted gzip body crash path was reachable. Updated compatible transitive body-parser to `1.20.9`; no Express major upgrade. |
| [GHSA-6pq8-jhm2-2vcw](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw), moderate | Express dependency `qs@6.16.0` | The advisory's vulnerable `qs.stringify` comma-array/object `toString` pattern was not found in application code; Express query parsing alone did not expose that sink. Installed `6.16.2`, within the existing dependency range. |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), moderate | Direct `uuid@10.0.0` and `bull@4.16.5 > uuid@8.3.2` | App and Bull call `uuid.v4()`; no affected caller-supplied-buffer API usage was found. Updated direct UUID to `11.1.1` and overrode Bull's nested UUID to that patched CommonJS-compatible release. Bull stayed at `4.16.5`; the local queue/worker integration passed. |

`npm ls uuid bull body-parser qs --all` confirmed the installed tree, and the final `npm audit --omit=dev` returned 0 vulnerabilities. Dependency metadata/release references: [body-parser 1.20.9](https://github.com/expressjs/body-parser/releases/tag/1.20.9), [qs 6.16.1](https://github.com/ljharb/qs/releases/tag/v6.16.1), and [uuid 11.1.1](https://github.com/uuidjs/uuid/releases/tag/v11.1.1). The full development dependency graph was not the target of this production-only audit.

One test invocation hit a transient native Node/Jest source-map assertion before reporting tests. The isolated integration suite and the subsequent complete server suite both passed; the complete server suite had 85 passing tests.

## E. RAG report

- Ingestion code reads PDFs, extracts text, chunks it, requests Gemini embeddings, stores chunk rows, and generates metadata. Embeddings request 768 dimensions, matching the schema's `vector(768)` column. The current Google documentation supports `gemini-embedding-2` with 768 output dimensions.
- Student retrieval is filtered to offerings in the authenticated student's academic class. Faculty retrieval is filtered to offerings assigned to the authenticated faculty ID.
- The query route applies `SIMILARITY_THRESHOLD` (default `0.55`) and returns `Not in provided material.` when retrieval is insufficient. The route sends retrieved chunks rather than whole PDFs to generation.
- The new checks prevent a successful-ready state without a complete, dimension-compatible vector set and prevent unsupported citation numbers from being surfaced.
- The current local generation model is `gemini-3.1-flash-lite`, set through `GOOGLE_AI_MODEL` in the ignored `server/.env` and used as the source fallback in both Gemini paths. Environment overrides remain supported. The embedding model remains `gemini-embedding-2`; no stored embeddings are regenerated when changing the generation model. [Gemini 3.1 Flash-Lite model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
- The Render blueprint still declares the previous `GOOGLE_AI_MODEL` value. Render configuration was intentionally not changed; the new generation model is local-only until separately reviewed and approved for deployment.
- No live upload-to-queue-to-vector-search-to-Gemini test was possible. The follow-up used the configured Gemini key for a synthetic direct API check, which returned HTTP 401; there was no successful provider response and no latency sample/median/p95. Citation relevance/entailment still requires successful real-provider evaluation; current automated route tests only validate that numeric citations map to retrieved chunks.

The follow-up changed the default generation ID to `gemini-3.6-flash`, removed deprecated `temperature` from Gemini generation requests, and added a 30-second configurable provider request timeout. Google currently documents `gemini-3.5-flash` as deprecated and automatically routed to 3.6; it documents `temperature` as ignored/deprecated for 3.6 and later. A live synthetic request was attempted with the configured key and returned HTTP 401, so no embedding, generation, or latency measurement succeeded. See the follow-up report for details and current official documentation links.

## F. Attendance report

- Faculty can create a session for an owned offering. Lab sessions require a lab group in the same branch/batch/division; lectures are division-wide.
- Students must be active, verified, assigned to a class, match the session class, and match the lab group when applicable. Nonce, expiry, duplicate record, and radius checks exist. Faculty roster query uses a left join so students with no attendance row display as absent. Faculty can make later present/absent corrections within their session scope.
- Coordinate range/type validation was added and tests pass. This does not make browser GPS spoof-proof; a user can falsify client-reported location. The short nonce window and rate limit are controls, not proof of physical presence.
- Student history now selects inactive sessions with `ended_at` set, filters by the student's current branch/batch/division and lab group where applicable, and left-joins the latest attendance record. Missing records and rejected attempts are returned as absent. `attendance_records` has a unique `(session_id, student_id)` constraint; the lateral query still selects only one row per session if duplicates exist. The client deduplicates by session ID and handles empty totals safely.
- Cancellation is not represented in the current schema or route lifecycle, so no separate cancelled status can be filtered. Active or unclosed sessions are excluded. The latest isolated PostgreSQL tests exercise persistence, class/lab isolation, marking, expiry, nonce replay/invalidity, duplicates, corrections, and history; GPS spoofing and browser/production behavior remain unverified.

## G. Deployment and infrastructure

- **Local:** frontend build/typecheck passed. Dedicated local PostgreSQL/Redis services were initialized and stopped after integration checks; their volumes are preserved. Real API upload, PDF extraction, standalone queue worker, vector persistence, and test-class access checks passed with a local deterministic provider.
- **Production:** no production database query, mutation, or deployment was performed. Live Vercel/Render health was not checked during this audit. The Render startup safety correction and all server fixes remain unpublished; Render's current service configuration is unchanged until an authorized deployment.
- **Storage:** uploaded resource PDFs are local files under `UPLOAD_DIR`, while Render config documents this storage as ephemeral. A restart can orphan DB rows from their files. A plan-only migration is in [OBJECT_STORAGE_MIGRATION_PLAN.md](OBJECT_STORAGE_MIGRATION_PLAN.md); no bucket was provisioned and no files were migrated.
- **Accounts:** no production account listing or data access was authorized. Synthetic fixtures in the isolated test database were cleaned up. Existing non-college account rows and related data were not deleted, edited, or role-reassigned; the new login policy should deny them until an administrator confirms/updates the verified institutional email under the approved account-recovery process.

## H. Change inventory

- `render.yaml` - removed destructive cleanup and account-seeding commands from service startup.
- `server/src/index.js` - protected direct uploads, rate-limited the DB health endpoint, and made generic error responses non-revealing.
- `server/src/routes/uploads.js` - new admin-only direct static upload access.
- `server/src/routes/resources.js` - verify PDF signature, reject missing/invalid uploads, clean newly written invalid files, and hide internal upload errors.
- `server/src/services/processor.js` - fail/retry incomplete embedding work and validate 768-dimensional vectors.
- `server/src/routes/attendance.js` - validate latitude, longitude, and radius bounds.
- `server/src/routes/attendance.js` - follow-up returns completed, eligible sessions including absences when no record exists, with one selected record per session.
- `client/src/routes/_authenticated/attendance.tsx`, `client/src/lib/attendance.ts` - aggregate unique session results and safely compute per-subject/overall totals.
- `server/src/services/rag.js`, `server/src/services/llmAdapter.js` - documented Gemini key header, sanitized provider errors, model selection, and timeout behavior.
- `server/src/routes/ask.js` - reject answers with absent/out-of-range citations.
- `server/src/routes/subjects.js`, `server/src/routes/academic.js` - return generic 500 messages.
- `server/tests/uploads-access.test.js`, `server/tests/resource-upload-validation.test.js`, `server/tests/processor.test.js` - new regression tests.
- `server/tests/attendance-groups.test.js`, `server/tests/ask-llm.integration.test.js` - added regression cases.
- `server/tests/attendance-history.test.js`, `server/tests/rag-provider.test.js`, `server/tests/llm-google-provider.test.js`, `client/src/test/attendance-history.test.ts` - follow-up API, provider-request, and attendance-summary tests.
- `server/tests/integration/local-postgres-worker.integration.test.js` - opt-in PostgreSQL/Redis integration using guarded local test credentials and synthetic fixtures.
- `server/src/jobs/queue.js`, `server/src/services/rag.js` - producer-only queue and test-only localhost provider override for deterministic integration.
- `server/src/services/processor.js`, `server/src/routes/resources.js` - PDF.js byte-buffer compatibility and resource-list SQL alias fixes found by integration testing.
- `server/package.json`, `server/package-lock.json` - PDFKit fixture dependency and patched production dependency graph; production audit reports zero vulnerabilities.
- `docs/ATTENDANCE_INTEGRATION_REMEDIATION.md` - follow-up findings, local checks, live-provider result, and disposable test setup.
- `docs/OBJECT_STORAGE_MIGRATION_PLAN.md` - separate plan-only storage migration document.
- `docs/PROJECT_AUDIT_REPORT.md` - this audit report.

No schema migration was added. Existing migrations were initialized against the isolated local `snippet_test` database; no production migration was run.

## I. Remaining work, prioritized

1. **Before any deploy:** review the local Render startup change, production configuration, and destination branch. It remains unpublished.
2. **P1:** owner to verify Gemini key status, project, and API restrictions; supply a corrected key through the local/server secret mechanism, then verify live embeddings, generation, citations/fallback, errors, and measured latency. The configured credential still returns HTTP 401.
3. **P1:** run browser end-to-end checks and authorized staging/production verification before claiming release readiness.
5. **P1:** plan object storage against `docs/OBJECT_STORAGE_MIGRATION_PLAN.md`; provider, cost, and backup decisions need separate approval.
6. **P2:** fix or explicitly defer the broken public student-ID verification page after deciding which identity fields are safe to expose.
7. **P2:** decide whether reminders, attendance planning, camera/file/voice Ask controls are planned or should be implemented; current controls/functions are empty/static.
8. **P2:** review trust-proxy configuration and distributed rate limiting for the actual Render topology; current rate limits are in-memory and `trust proxy` is set to `true`.
9. **P2:** consider moving JWT/refresh-token storage from `localStorage` to a secure cookie architecture with CSRF protection; this needs a staged auth design and regression tests.
10. **P3:** resolve frontend lint findings incrementally without applying bulk formatting to the user's pre-existing uncommitted files.

## J. Readiness assessment

- **Authentication:** backend checks and strict process-local auth rate limiting have unit coverage; confidence **medium-low** until production DB/OAuth/SMTP/session behavior is tested. Refresh-token revocation exists; localStorage token exposure remains a known concern.
- **Resource management:** real local API upload, queue/standalone worker, PDF extraction, pgvector storage, retry failure, and class authorization passed with a deterministic provider; confidence **medium** pending live Gemini and production storage/provider verification.
- **RAG:** route behavior and failure handling are covered with mocks; confidence **low** for real provider quality/performance.
- **Attendance:** server-side class/lab/history SQL passed against isolated PostgreSQL fixtures; confidence **medium** pending browser and broader lifecycle tests. Client location is not spoof-proof.
- **Profiles/academic hierarchy/admin:** implemented; confidence **low-medium** without live database.
- **Reminders, attendance AI planning, public ID verification:** not ready; missing or placeholder data paths.
- **Production deployment:** not assessed live in this audit and intentionally left unchanged.

Snippet is **not ready to call fully verified or complete**. Local PostgreSQL/worker checks provide stronger evidence for covered flows. Live external-provider behavior, SMTP, browser end-to-end, remaining workflows, and production behavior remain unverified.
