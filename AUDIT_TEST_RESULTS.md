# Snippet — Audit Test Results

**Repository:** `S:\ERP`
**Audit date:** Sun Oct 25 2026
**Status:** AUDIT ONLY — no source code, schema, env, or deployment changes made

Test-evidence categories used throughout this report:
- **STATIC / CODE-REVIEWED** — Verified by reading source code only. No execution.
- **LOCALLY EXECUTED AND PASSED** — Command run locally, result observed.
- **LIVE API TESTED** — Executed against a running service. NOT performed (no live access / would risk production data).
- **LIVE BROWSER E2E TESTED** — Executed in a browser against the live frontend. NOT performed.
- **NOT VERIFIED** — Could not be performed due to missing credentials, dependencies, running service, or permissions.

---

## 1. Tests actually executed

| # | Command | Working dir | Result | Category | Notes |
|---|---------|-------------|--------|----------|-------|
| T1 | `npm test` | `S:\ERP\server` | **10 suites, 65 tests, ALL PASSING** | LOCALLY EXECUTED AND PASSED | Jest + supertest. Heavy mocking of `pool`, `rag`, `llmAdapter`, `auth` middleware. Unit-level, not integration against a real DB. |
| T2 | `npm run build` | `S:\ERP\client` | **BUILD SUCCEEDED** (after `npm install`) | LOCALLY EXECUTED AND PASSED | Vite 8.1.5 + Nitro build. Client + SSR + Nitro. Output to `.output/`. ~1.1MB client JS. |
| T3 | `npm run test` | `S:\ERP\client` | **1 file, 1 test, PASSING** | LOCALLY EXECUTED AND PASSED | Vitest. App routing test only. |
| T4 | `npm run lint` | `S:\ERP\client` | **7,701 prettier errors** (7,692 errors, 9 warnings) | LOCALLY EXECUTED | All CRLF line-ending formatting errors. Cosmetic; does not block build. Fixable with `prettier --write`. |
| T5 | `git status` / `git log` | `S:\ERP` | Clean working tree except listed modified/untracked files | STATIC / CODE-REVIEWED | Branch `main`, up to date with `origin/main`. 30+ modified client files; untracked `supabase/`, `firebase-analytics.ts`, `firebase.functions.ts`, `.vercelignore`, `sitemap.xml`. |
| T6 | `npm install` | `S:\ERP\client` | **SUCCEEDED** (6 added, 1 removed, 176 changed; 12 vulnerabilities: 6 moderate, 6 high) | LOCALLY EXECUTED | Needed before build. Vulnerabilities not remediated (audit only). |

### Server test suites (all passing, mocked)
- `auth-domain.test.js`
- `ask-not-found.test.js` — RAG fallback: verifies `"Not in provided material."` exact phrase when LLM returns no citation.
- `attendance-groups.test.js`
- `attendance.test.js` — Haversine distance (NY–London > 5,500 km; tiny offset < 50 m).
- `chunk-metadata.test.js`
- `e2e.test.js` — RAG pipeline with mocked DB/rag/llm. Covered question → citation; uncovered question → NOT_FOUND.
- `google-identity.test.js`
- `student-roll-number.test.js`
- `threshold.test.js`

**Limitation:** All server tests mock the database pool and external AI services. None verify real PostgreSQL behavior, real pgvector similarity, or real Gemini API calls. `server/e2e_test.js` (live integration against `https://snippet-api-pf9m.onrender.com`) exists but was **not executed** — it mutates production data (registers users, creates hierarchy, uploads files) and requires live access.

---

## 2. Tests blocked / not performed

| # | Test | Reason blocked | What is needed |
|---|------|----------------|----------------|
| B1 | Live backend health (`GET /api/health`) | Per `integration_verification_report.md`, Render deployment returns 404; no live access in this audit | Render service access; fixed deployment |
| B2 | Live frontend page load | Per integration report, Vercel deployment failed (Next.js auto-detect → 404) | Vercel project reconfigured to Vite |
| B3 | End-to-end registration → login → onboarding | Requires SMTP email delivery (not configured in this audit) and live backend | SMTP credentials; live backend |
| B4 | Real PDF upload → processing → RAG answer | Requires live backend + Redis + `GOOGLE_AI_API_KEY` + persistent storage | Live staging environment; object storage |
| B5 | Face matching with real biometric data | Face match is a mock; no `face_enrollments` table; no biometric provider | Real face provider + schema table |
| B6 | Voice input (STT) | No backend endpoint; Mic button is non-functional | STT endpoint + frontend wiring |
| B7 | Image question (vision/OCR) | No backend endpoint; Camera button is non-functional | Vision endpoint + frontend wiring |
| B8 | Browser-based E2E (Playwright/Cypress) | No browser automation tooling configured; no live frontend | E2E framework + live frontend |
| B9 | Load / performance testing | No tooling; no live service | k6/Lighthouse + staging |
| B10 | Accessibility audit (axe/Lighthouse) | No live frontend; not browser-tested | Live frontend + a11y tooling |
| B11 | Production database inspection | No DB credentials access; audit rule forbids connecting to production DB | Staging DB copy |
| B12 | Token refresh / logout flow | No logout endpoint exists | Logout implementation |
| B13 | Resource download authorization (cross-class) | Requires live backend + two enrolled users | Live staging environment |

---

## 3. Verification summary by evidence type

| Evidence type | Features covered |
|---------------|------------------|
| STATIC / CODE-REVIEWED | All backend routes, middleware, schema, migrations, auth logic, RAG vector search scoping, attendance authorization, file storage config, deployment config |
| LOCALLY EXECUTED AND PASSED | Server unit tests (65), client build, client vitest (1), client lint (revealed formatting errors only) |
| LIVE API TESTED | None |
| LIVE BROWSER E2E TESTED | None |
| NOT VERIFIED | All live deployment behavior, real RAG with a PDF, face matching, voice, image questions, mobile responsiveness, accessibility, production DB state |

---

## 4. Important caveats

- **No production data was touched.** No migrations run, no DB writes, no env changes, no deployments triggered.
- **No secrets were exposed.** No JWTs, API keys, or DB connection strings appear in this report or any test.
- **Build passing ≠ production working.** The client build succeeds locally, but the Vercel deployment is broken per the integration report.
- **65 passing server tests ≠ verified features.** They are unit tests with mocked DB and AI services. They confirm route logic shapes, not real database or Gemini behavior.
- **The ECC repository (`S:\ERP-ECC`) was cloned but is unrelated to Snippet.** ECC is an agent framework; it is not installed or used by the Snippet ERP.

---

## 5. Recommended next test execution (after P0 fixes)

1. Fix Vercel/Render deployment, then run B1 and B2.
2. Stand up a local staging stack via `docker-compose.yml` (db + redis + server + client).
3. Run `npm run db:init` against local DB; verify idempotency by running twice.
4. Execute `server/e2e_test.js` against local backend (not production) — adjust `BASE_URL` to `http://localhost:3001/api`.
5. Add integration tests for resource upload → processing → RAG with a real local PDF and a local embedding stub.
6. Add browser E2E (Playwright) for the critical path: login → onboarding → upload → ask → attendance mark.

**End of AUDIT_TEST_RESULTS.md.**
