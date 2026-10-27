# Snippet Campus ERP + AI Platform — Full Repository Audit Report

**Repository:** `S:\ERP` (local clone of Snippet ERP)
**Related ECC framework repo:** `S:\ERP-ECC` (cloned from `https://github.com/affaan-m/ECC`)
**Audit date:** Sun Oct 25 2026
**Status:** AUDIT ONLY — no source code, schema, env, or deployment changes made

---

## 1. Executive Summary

Snippet is a campus-academic ERP with an integrated AI study assistant ("Ask Snippet"). It is a full-stack monorepo with:

- `client/` — React + TanStack Start / TanStack Router + Vite frontend, deployed on Vercel at `https://client-phi-lake.vercel.app`
- `server/` — Node.js/Express REST API, deployed on Render at `https://snippet-api-pf9m.onrender.com`
- PostgreSQL + pgvector database (Render managed / Docker `ankane/pgvector`)
- Redis + Bull for background resource processing
- Gemini API for embeddings and generation
- JWT-based authentication with college email (`@ustu.edu.in`) enforcement

**Overall health:** The codebase is **not production-ready**. Core workflows are partially implemented but several critical gaps exist:

- Deployment is broken (frontend 404s on Vercel; backend `/api/health` returns 404 per integration report)
- File uploads use Render ephemeral local disk — data loss on every redeploy
- Background worker is not deployed as a separate process; resource processing may never complete
- Profile editing UI is missing (backend endpoint exists, frontend form removed)
- Face authentication is MVP-mocked (always returns match=true)
- Voice and image question inputs are UI buttons only — no backend wiring
- Registration allows any role string to be passed but server hardcodes `'student'` — a latent risk if backend logic changes

The backend code itself is well-structured, uses parameterized queries (SQL injection safe), enforces college-email domain, validates JWTs against the database on each request, and includes a solid test suite (65 tests passing). The frontend builds successfully after `npm install` and has 1 passing vitest. Lint has ~7,700 prettier errors (CRLF line endings) but these are formatting-only.

---

## 2. Actual Repository Architecture

```
S:\ERP/
├── package.json              # Root workspace (concurrently dev server + client)
├── schema.sql                # Root SQL schema (duplicated from server/src/db/schema.sql)
├── migration_01.sql          # Root migration (referenced by docker-compose only)
├── docker-compose.yml        # Local dev: db, redis, server, worker, client
├── render.yaml               # Render production blueprint (db, redis, api service)
├── index.js                  # Root entry (unused stub)
├── index.js                  # Root entry (unused stub)
├── openapi.yaml              # OpenAPI contract
├── openapi_integrations.yaml # OpenAPI integrations
├── curl_out.txt              # Curl output artifact
├── dummy.pdf                 # Test PDF
├── extract_apis.js           # API extraction script
├── extract_frontend_apis.js  # Frontend API extraction script
├── test_endpoints.js         # Endpoint test script
├── test_user.json            # Test user fixture
├── test_plan.md              # Test plan
├── implementation_plan.md    # Implementation plan
├── frontend_map.md           # Frontend map
├── integration_verification_report.md # Integration verification report
├── PULL_REQUEST.md           # PR template
├── AUTH_DOMAIN_POLICY.md     # Auth domain policy
├── PROFILE_ONBOARDING.md     # Profile onboarding doc
├── worker_design.md          # Worker design doc
├── face_adapter_spec.md      # Face adapter spec
├── face_match_spec.md        # Face match spec
├── skills-lock.json          # Skills lock
├── snippet_erp_prd.md        # Product requirements doc
├── client/                   # Frontend (TanStack Start + Vite)
│   ├── src/
│   │   ├── router.tsx        # TanStack router bootstrap
│   │   ├── routeTree.gen.ts  # Generated route tree
│   │   ├── server.ts         # TanStack server entry
│   │   ├── start.ts          # TanStack start entry
│   │   ├── styles.css        # Design tokens
│   │   ├── lib/
│   │   │   ├── api.ts        # API client + token refresh
│   │   │   ├── avatar.ts     # Avatar URL resolver
│   │   │   ├── face.ts       # Face status hook
│   │   │   ├── firebase-analytics.ts
│   │   │   └── firebase.functions.ts
│   │   ├── hooks/
│   │   │   ├── use-auth.ts   # useMe() hook
│   │   │   └── use-mobile.tsx
│   │   ├── routes/
│   │   │   ├── __root.tsx
│   │   │   ├── auth.tsx
│   │   │   ├── complete-profile.tsx
│   │   │   ├── verify.$studentNo.tsx
│   │   │   └── _authenticated/
│   │   │       ├── route.tsx      # Auth guard + /auth/me
│   │   │       ├── index.tsx      # Home (student/faculty split)
│   │   │       ├── ask.tsx        # Ask Snippet RAG UI
│   │   │       ├── attendance.tsx # Attendance mark + history
│   │   │       ├── resources.tsx  # Resource list + upload
│   │   │       ├── subjects.$subjectId.tsx
│   │   │       ├── profile.tsx    # ID card + profile (view-only edit)
│   │   │       ├── face-setup.tsx
│   │   │       ├── reminders.tsx
│   │   │       ├── faculty.tsx    # Faculty attendance console
│   │   │       └── admin.tsx      # Admin faculty activation + AcademicAdmin
│   │   ├── components/snippet/
│   │   │   ├── AppShell.tsx       # Bottom nav + floating Ask Snippet
│   │   │   ├── AcademicAdmin.tsx  # Hierarchy management
│   │   │   ├── ProfileForm.tsx    # Profile edit form
│   │   │   ├── FacultyHome.tsx
│   │   │   ├── MenuSheet.tsx
│   │   │   ├── ManualRequest.tsx
│   │   │   ├── AttendancePlan.tsx
│   │   │   ├── SectionsManager.tsx
│   │   │   └── SignInHelp.tsx
│   │   └── test/
│   ├── .output/              # Build output (Vercel)
│   ├── vercel.json           # Vercel config (Vite framework, VITE_API_URL)
│   ├── vite.config.ts        # TanStack Start Vite config
│   ├── drizzle.config.ts     # Drizzle (unused — raw SQL used instead)
│   ├── supabase/             # Supabase artifacts (leftover, unused)
│   └── .env / .env.local     # Environment (not committed)
├── server/                   # Backend (Express)
│   ├── src/
│   │   ├── index.js          # App entry, CORS, routes, queue init
│   │   ├── db/
│   │   │   ├── pool.js       # pg Pool
│   │   │   ├── init.js       # Schema init (runs schema.sql + migrations)
│   │   │   ├── schema.sql    # Authoritative schema
│   │   │   ├── migration_01.sql
│   │   │   ├── migration_02_student_profiles.sql
│   │   │   └── migration_03_student_photos_and_manual_attendance.sql
│   │   ├── jobs/
│   │   │   └── queue.js      # Bull queue + processor
│   │   ├── middleware/
│   │   │   ├── auth.js       # JWT auth + role authorization
│   │   │   └── rateLimit.js  # express-rate-limit
│   │   ├── routes/
│   │   │   ├── auth.js       # Register, login, google, refresh, me, avatar, onboarding
│   │   │   ├── academic.js   # Hierarchy CRUD (admin only)
│   │   │   ├── subjects.js   # Subjects + offerings
│   │   │   ├── resources.js  # Upload, list, status, delete, download, process
│   │   │   ├── ask.js        # RAG query + history
│   │   │   ├── attendance.js # Sessions, nonce, mark, end, override, roster
│   │   │   ├── admin.js      # Stats, users, logs
│   │   │   └── face.js       # Face match (MVP mock)
│   │   ├── services/
│   │   │   ├── rag.js        # Embedding + vector search + answer generation
│   │   │   ├── processor.js  # PDF extraction, chunking, embedding, metadata
│   │   │   ├── llmAdapter.js # Pluggable LLM (mock/openai/google)
│   │   │   ├── googleIdentity.js
│   │   │   └── emailVerification.js
│   │   └── utils/
│   │       ├── studentRollNumber.js
│   │       ├── geo.js        # Haversine distance
│   │       └── collegeEmail.js
│   ├── tests/                # Jest tests (65 passing)
│   ├── e2e_test.js           # Live integration test against production URL
│   ├── test_upload.js
│   ├── package.json
│   ├── package-lock.json
│   ├── Dockerfile
│   └── .env (not committed)
```

**Architecture notes:**

- The frontend is **TanStack Start** (not plain Vite SPA). It uses `@tanstack/react-start` with Nitro SSR/build, targeting Cloudflare module preset via Vercel. It also uses TanStack Router for client-side routing.
- The backend is a plain Express app. It does **not** use TanStack server functions.
- The two repositories are separate: the Snippet ERP (`S:\ERP`) and the ECC agent framework (`S:\ERP-ECC`) are unrelated codebases. ECC is **not** installed or used by Snippet.
- Database initialization runs `schema.sql` + `migration_02` + `migration_03` on every server start via `npm run db:init`. Render `startCommand` is `npm run db:init && node src/index.js`.

---

## 3. Technology Stack

| Layer | Technology | Version / Source |
|-------|-----------|------------------|
| Frontend framework | React 19 + TanStack Start + TanStack Router | `client/package.json` |
| Frontend build | Vite 8.1.5 + Nitro (Cloudflare preset) | `client/package.json` |
| Frontend styling | Tailwind CSS 4.2.1 + Radix UI + shadcn/ui primitives | `client/package.json` |
| Frontend state | TanStack Query v5 | `client/package.json` |
| Frontend HTTP | Native `fetch` via `client/src/lib/api.ts` | — |
| Backend | Node.js Express 4.21 | `server/package.json` |
| Backend language | JavaScript (CommonJS, not TypeScript) | `server/src/*.js` |
| Database | PostgreSQL + pgvector | `server/src/db/pool.js` |
| ORM/Query | Raw `pg` client (no ORM despite `drizzle-kit`/`drizzle-orm` in client devDeps) | `server/package.json` |
| Queue | Bull 4.12.2 + Redis | `server/src/jobs/queue.js` |
| Auth | JWT (jsonwebtoken) + bcryptjs | `server/src/routes/auth.js` |
| AI / Embeddings | Google Gemini API (`gemini-embedding-2`, `gemini-3.5-flash`) | `server/src/services/rag.js` |
| PDF parsing | `pdf-parse` 1.1.1 | `server/src/services/processor.js` |
| Email | Nodemailer SMTP | `server/src/services/emailVerification.js` |
| Google OAuth | `google-auth-library` | `server/src/services/googleIdentity.js` |
| Testing | Jest + supertest (server), Vitest (client) | `server/package.json`, `client/package.json` |
| Deployment frontend | Vercel | `client/vercel.json` |
| Deployment backend | Render | `render.yaml` |
| Local dev | Docker Compose | `docker-compose.yml` |

**Unused / leftover dependencies:**
- `@supabase/supabase-js` and `firebase` in client — referenced by `firebase-analytics.ts` and `firebase.functions.ts` but the AGENTS.md states "Firebase is additive only" and Cloud is the system of record. Supabase directory exists under `client/supabase/` but no Supabase client code is imported in the frontend routes reviewed.
- `drizzle-kit`, `drizzle-orm`, `postgres` in client devDependencies — `drizzle.config.ts` exists but the backend uses raw SQL. No Drizzle usage found in backend.
- `concurrently` at root — only used for `npm run dev`.

---

## 4. Production Architecture and Deployment

### Frontend (Vercel)
- `client/vercel.json` sets framework `vite`, build `npm run build`, output `.output/public`, env `VITE_API_URL=https://snippet-api-pf9m.onrender.com`.
- Build succeeds locally after `npm install`.
- **Per `integration_verification_report.md`:** Vercel deployment **failed** — auto-detected Next.js instead of Vite, serving a 404/default page. The domain `client-phi-lake.vercel.app` is referenced but may not be serving the built app.

### Backend (Render)
- `render.yaml`: free Postgres (`snippet-db`), free Redis (`snippet-redis`), free Node web service (`snippet-api`), rootDir `server`, build `npm ci --production`, start `npm run db:init && node src/index.js`, healthCheckPath `/api/health`.
- **Per `integration_verification_report.md`:** `/api/health` returns **404** — latest API code not deployed or wrong URL.
- `startCommand` runs `db:init` on every restart. `schema.sql` uses `CREATE TABLE IF NOT EXISTS` and `ALTER ... ADD COLUMN IF NOT EXISTS`, so it is idempotent and safe to repeat. However, running DDL on every container restart is not ideal for production.

### Worker
- `docker-compose.yml` defines a separate `worker` service running `npm run worker || node src/services/worker.js`.
- **`render.yaml` does NOT include a worker service.** On Render, resource processing runs only if the queue initializer succeeds inside the API process (Bull queue is created in `server/src/index.js`). Jobs are processed in the same process as the API, not a dedicated worker.
- If Redis is unavailable, `initQueue()` catches the error and logs a warning; uploads still succeed but resources stay `queued` forever unless manually triggered via `POST /api/resources/:id/process`.

### File storage
- `UPLOAD_DIR` defaults to `./uploads` (local disk). Render free tier has ephemeral filesystem — **all uploads are lost on redeploy/restart**. `render.yaml` explicitly notes: "Ephemeral storage since disks aren't supported on free tier."
- Profile photos are stored in PostgreSQL `user_avatars.image_data` (BYTEA) — safe from ephemeral loss.

### CORS
- `server/src/index.js`: allows `CLIENT_URL` origins plus any `*.vercel.app` preview. Credentials enabled. This is permissive but acceptable for a college app with JWT auth.

---

## 5. Feature Inventory

See `FEATURE_STATUS_MATRIX.md` for the complete matrix. Summary:

| Feature | Status |
|---------|--------|
| Authentication (email/password) | IMPLEMENTED, NOT FULLY TESTED |
| Registration (student role only) | IMPLEMENTED, NOT FULLY TESTED |
| Google OAuth | IMPLEMENTED, NOT FULLY TESTED |
| Email verification | IMPLEMENTED (requires SMTP env) |
| Token refresh | IMPLEMENTED |
| Profile edit (PATCH /api/auth/me) | BACKEND ONLY — frontend form removed |
| Profile photo upload | IMPLEMENTED (stored in Postgres) |
| Student ID card + QR | IMPLEMENTED (view-only) |
| Academic hierarchy CRUD | IMPLEMENTED (admin only) |
| Subject + offering management | IMPLEMENTED |
| Resource upload (PDF) | IMPLEMENTED |
| Resource processing (PDF→chunks→embeddings) | PARTIALLY IMPLEMENTED (worker not deployed separately) |
| Resource download | IMPLEMENTED (ephemeral disk — data loss risk) |
| RAG / Ask Snippet | IMPLEMENTED (mock LLM provider default) |
| Conversation history | IMPLEMENTED (ai_audit_logs) |
| Attendance (nonce + GPS) | IMPLEMENTED |
| Faculty attendance console | IMPLEMENTED |
| Admin stats/users/logs | IMPLEMENTED |
| Face enrollment | UI ONLY (face-setup.tsx) |
| Face matching | MOCKED (always match=true) |
| Voice input | UI ONLY (Mic button, no backend) |
| Image questions | UI ONLY (Camera button, no backend) |
| Reminders | UI ONLY (reminders.tsx stub) |
| Notifications | MISSING |
| Results/grades | MISSING |
| Deployment | BROKEN (per integration report) |

---

## 6. Frontend Audit

### Authentication & identity
- **Login/Register:** `client/src/routes/auth.tsx` — complete UI with email validation (`@ustu.edu.in` only), password min 6, Google OAuth, resend verification. Works.
- **Logout:** No explicit logout endpoint or UI action found. Tokens are only cleared on 401 or via `clearTokens()`. **Missing logout.**
- **Token refresh:** `client/src/lib/api.ts` `refreshAccessToken()` — implemented. On 401, retries once; on failure clears tokens and redirects to `/auth`.
- **Session expiry:** Handled via 401 intercept in `api()`.
- **Current user:** `/auth/me` via `useMe()` hook. Redirects to `/complete-profile` if `requiresOnboarding`.
- **Role-based redirects:** `__root`/`_authenticated` route guards redirect to `/auth` if no token. `_authenticated` redirects to `/complete-profile` if onboarding required. Home splits student/faculty.

### Student experience
- **Home/dashboard:** `client/src/routes/_authenticated/index.tsx` — shows quick links, schedule (hardcoded mock data), feed (hardcoded mock data), attendance progress (hardcoded 87.4%). **Mostly mocked/static.**
- **Subjects:** `client/src/routes/_authenticated/subjects.$subjectId.tsx` — exists but not reviewed in depth.
- **Resources:** `resources.tsx` — real API calls, upload card, status polling, download via blob. Working.
- **Ask Snippet:** `ask.tsx` — real API call to `/ask`, subject selector, citation display. Camera/Mic buttons present but **no-op** (UI only).
- **Attendance:** `attendance.tsx` — mark by nonce + geolocation, history, per-subject stats. Working against backend. `askAttendanceAI` imported from `@/lib/attendance.functions` but that file was not found — likely references a removed Lovable server function.
- **Profile/ID card:** `profile.tsx` — ID card with QR, view-only details. Edit Profile section renders `ProfileForm` but per integration report the edit button was commented out; form may not be reachable.
- **Face setup:** `face-setup.tsx` — exists, not reviewed in depth.

### Faculty experience
- **Faculty dashboard:** `faculty.tsx` — attendance console: start session (geolocation + nonce), end session, view roster, mark present/absent, poll nonce, view session history. Working against backend.
- **Subjects:** faculty sees own offerings via `/subjects`.

### Admin experience
- **Admin:** `admin.tsx` — lists faculty users, activate/deactivate via `PATCH /admin/users/:id`. Renders `AcademicAdmin` for hierarchy management. Working.

### Frontend issues
1. **Hardcoded mock data** on home page (schedule, feed, attendance percentage).
2. **No logout** button/endpoint.
3. **Profile edit** — backend `PATCH /api/auth/me` exists; frontend `ProfileForm` exists but integration report says edit button was commented out.
4. **Camera/Mic buttons** in `ask.tsx` are non-functional (no backend voice/image endpoints).
5. **`attendance.tsx`** imports `askAttendanceAI` from `@/lib/attendance.functions` — file not present in repository (removed Lovable server function).
6. **Build lint:** ~7,700 prettier errors (CRLF line endings) — formatting only, does not break build.
7. **Vercel deploy** failing per integration report (Next.js auto-detection).

---

## 7. Backend / API Contract Audit

All routes are mounted under `/api` in `server/src/index.js`. The frontend `api.ts` constructs base as `VITE_API_URL + /api` (or `http://localhost:3001/api`).

**Endpoint inventory:**

| Method | Path | Auth | Roles | File |
|--------|------|------|-------|------|
| POST | /auth/register | No | — | auth.js |
| POST | /auth/login | No | — | auth.js |
| POST | /auth/google | No | — | auth.js |
| POST | /auth/refresh | No | — | auth.js |
| GET | /auth/me | Yes | all | auth.js |
| PATCH | /auth/me | Yes | all | auth.js |
| POST | /auth/verify-email | No | — | auth.js |
| POST | /auth/verification/resend | No | — | auth.js |
| GET | /auth/avatar | Yes | all | auth.js |
| PUT | /auth/avatar | Yes | all | auth.js |
| DELETE | /auth/avatar | Yes | all | auth.js |
| GET | /auth/onboarding/options | Yes (onboarding token) | student | auth.js |
| POST | /auth/complete-profile | Yes (onboarding token) | student | auth.js |
| GET | /academic/hierarchy | Yes | all | academic.js |
| POST | /academic/branches | Yes | admin | academic.js |
| POST | /academic/batches | Yes | admin | academic.js |
| POST | /academic/divisions | Yes | admin | academic.js |
| POST | /academic/semesters | Yes | admin | academic.js |
| POST | /academic/classes | Yes | admin | academic.js |
| POST | /academic/lab-groups | Yes | admin | academic.js |
| GET | /subjects | Yes | all | subjects.js |
| POST | /subjects | Yes | faculty, admin | subjects.js |
| POST | /subjects/offerings | Yes | admin, faculty | subjects.js |
| GET | /subjects/:id | Yes | all | subjects.js |
| POST | /resources/upload | Yes | faculty | resources.js |
| GET | /resources | Yes | all | resources.js |
| GET | /resources/:id | Yes | all | resources.js |
| GET | /resources/:id/status | Yes | all | resources.js |
| DELETE | /resources/:id | Yes | faculty, admin | resources.js |
| POST | /resources/:id/process | Yes | faculty, admin | resources.js |
| GET | /resources/:id/download | Yes | all | resources.js |
| POST | /ask | Yes | student, faculty | ask.js |
| GET | /ask/history | Yes | all | ask.js |
| POST | /attendance/start | Yes | faculty | attendance.js |
| GET | /attendance/:sessionId/nonce | Yes | faculty | attendance.js |
| POST | /attendance/mark | Yes | student | attendance.js |
| POST | /attendance/:sessionId/end | Yes | faculty | attendance.js |
| POST | /attendance/:sessionId/override | Yes | admin, faculty | attendance.js |
| GET | /attendance/:sessionId/roster | Yes | faculty, admin | attendance.js |
| PUT | /attendance/:sessionId/roster/:studentId | Yes | faculty, admin | attendance.js |
| GET | /attendance/sessions | Yes | faculty, admin | attendance.js |
| GET | /attendance/my/records | Yes | student | attendance.js |
| GET | /attendance/:sessionId/records | Yes | faculty, admin | attendance.js |
| GET | /admin/stats | Yes | admin | admin.js |
| GET | /admin/users | Yes | admin | admin.js |
| PATCH | /admin/users/:id | Yes | admin | admin.js |
| PATCH | /admin/users/:id/class | Yes | admin | admin.js |
| GET | /admin/logs | Yes | admin | admin.js |
| POST | /face/match | Yes | all | face.js |
| GET | /health | No | — | index.js |
| GET | /health/db | No | — | index.js |

**Frontend ↔ Backend mismatches:**

1. **Profile editing:** Backend `PATCH /api/auth/me` exists and is complete. Frontend `profile.tsx` edit button reportedly commented out (per integration report). `ProfileForm.tsx` exists. **Frontend form not connected/reachable.**
2. **Resources listing:** Frontend `resources.tsx` passes `subjectOfferingId` (correct). Backend supports both `subjectOfferingId` and legacy `subjectId`. OK.
3. **Attendance mark:** Frontend sends `{ nonce, latitude, longitude }` without `sessionId`. Backend resolves session by nonce via global lookup. OK — but nonce is 6-char hex and not scoped to student; a student could guess another session's nonce if they know it (low risk, nonce expires in 30s).
4. **Ask Snippet:** Frontend `ask.tsx` sends `{ query, subjectId }`. Backend expects `{ query, subjectId }`. OK.
5. **No `/logout` endpoint:** Frontend has no logout action.
6. **No voice/image endpoints:** Frontend has Camera/Mic buttons but backend has no voice STT or image vision endpoints.

**Canonical ID distinction:** The code uses `subjectId` (base subject) and `subjectOfferingId` (subject + class + faculty binding) somewhat inconsistently:
- Resources: `subject_id` (required) + `subject_offering_id` (optional). Upload verifies ownership of offering if provided, else subject.
- Ask: `subjectId` is required; vector search filters by `subject_id` plus offering scope via `userScope.academicClassId`.
- Attendance: `subject_id` (required) + `subject_offering_id` (optional).

The `subject_id` on resources is denormalized and not necessarily consistent with the offering's subject. A resource uploaded via legacy `subjectId` path won't appear under an offering filter, and vice versa. **This is a data-integrity risk.**

---

## 8. Database / Domain Model Audit

**Schema** is in `server/src/db/schema.sql` (authoritative) with a duplicate at root `schema.sql`. Migrations:
- `migration_01.sql` — referenced only by docker-compose (not applied by init.js)
- `migration_02_student_profiles.sql` — user_profiles, user_auth_identities, academic_lab_groups, seed branches/batches/divisions/classes/lab-groups
- `migration_03_student_photos_and_manual_attendance.sql` — user_avatars, attendance_records status allows 'absent'

**Academic model:** Branch → Batch → Division → Semester → Academic Class → Subject Offering → Faculty Assignment / Student Enrollment.

- `academic_classes` has `branch_id, batch_id, division_id, semester_id` with UNIQUE constraint — supports the model correctly.
- `users.academic_class_id` — a student/faculty is assigned to ONE class. Enrollment in subjects is **implicit** via the class → subject_offering relationship. There is NO explicit student-subject enrollment used by the current code (except legacy `subject_enrollments` table which is unused).
- `subject_offerings` binds subject + class + faculty with `UNIQUE(subject_id, academic_class_id)` — note: this unique constraint does NOT include `faculty_id`, so the same subject+class cannot be offered twice even by different faculty. This is a **limitation** for team-taught courses.
- `subject_enrollments` table exists but is **not used** by any route. Attendance enrollment check uses `academic_class_id` + branch/batch/division matching, not `subject_enrollments`.

**Missing / weak constraints:**
- No foreign key from `resources.subject_offering_id` with `ON DELETE CASCADE` in base schema (added in init.js with `ON DELETE CASCADE`).
- `attendance_records` originally CHECK only `present`/`rejected`; migration_03 adds `absent`.
- No index on `resources.subject_offering_id` (only `subject_id` implicitly via PK).
- No index on `attendance_sessions.subject_offering_id`.
- `resource_chunks.embedding` is `vector(768)` — matches Gemini embedding-2 output. IVFFlat index created in init.js but may fail if no data (deferred).
- `users.email` is UNIQUE but registration normalizes with `lower(trim(email))` while the unique constraint is case-sensitive on raw value. Two registrations with `A@x.com` and `a@x.com` would pass the application check but violate DB unique constraint → 500 error. **Bug.**

**Idempotency of `npm run db:init`:**
- Uses `CREATE TABLE IF NOT EXISTS`, `ALTER ... ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING` for seeds. **Safe to run repeatedly.** Confirmed by code inspection.

**Multi-tenancy:** Data segregation is by `academic_class_id` / branch / batch / division, not by a tenant ID. All users share the same database. RLS is **not** used; authorization is application-level. This is acceptable for a single-institution app but does not support multiple isolated colleges.

---

## 9. Authentication / Authorization / Security Audit

**Password:** bcryptjs with 12 rounds. Good.

**Registration:** Hardcodes `role = 'student'`. The frontend registration form does not send a `role` field. The e2e test script (`server/e2e_test.js` line 37) sends `role: 'admin'` but the server ignores it. **No public admin registration via API.** However, if the frontend or a future change passes `role` in the body, the server would need to explicitly ignore it — currently it does (hardcoded), so this is safe today but fragile.

**JWT:** Access token 15m, refresh 7d. Secret from `JWT_SECRET` (Render auto-generates). Refresh verifies `is_active`, `email_verified`, college email, profile complete. Access token middleware (`authenticate`) re-queries the DB on every request and checks `is_active`, `email_verified`, college email — **old JWTs are invalidated if user is deactivated or unverified.** Good.

**Token storage:** `localStorage` (`snippet_token`, `snippet_refresh_token`). Vulnerable to XSS. No `HttpOnly` cookies. **Security weakness** but common for SPA.

**Logout:** No logout endpoint, no token revocation/blacklist. Refresh tokens are valid until expiry. **Security gap.**

**Role enforcement:** `authorize('admin'|'faculty'|'student')` used consistently. Admin routes protected. Faculty routes check ownership (`so.faculty_id = $2`, `uploaded_by = req.user.id`). Student routes check enrollment via class/division matching.

**CORS:** Allows `CLIENT_URL` + `*.vercel.app`. Permissive preview allowance.

**Rate limiting:** `apiLimiter` 100/15min, `authLimiter` 20/15min, `ragLimiter` 10/min. Applied via `app.use('/api', apiLimiter)` then stricter limiters on specific routes. Note: `apiLimiter` applies to ALL `/api` routes including health? No — health is registered before `app.use('/api', apiLimiter)`. Good.

**File upload:** Multer disk storage, PDF-only mimetype filter, 20MB limit. No virus scanning. File path stored in DB. Download has no authorization check beyond authentication (any authenticated user can download any resource by ID). **Authorization gap:** download does not verify the user has access to the resource's subject/offering.

**SQL injection:** All queries use parameterized `$1` placeholders via `pg`. Safe.

**Error messages:** Generic ("Registration failed", "Login failed"). No stack traces leaked to client (stack logged server-side only). Good.

**Secrets:** `JWT_SECRET`, `GOOGLE_AI_API_KEY`, SMTP vars, `GOOGLE_CLIENT_ID` — all from env, not committed. `render.yaml` marks sensitive ones `sync: false`.

**Email verification:** Required before login. SMTP must be configured or registration returns 503. Generic resend message prevents enumeration.

**Google OAuth:** Verifies ID token, checks `hd` (hosted domain) = college domain, email verified. Creates account auto-verified. Good.

**Critical finding:** No admin provisioning path — the first admin must be inserted directly into the DB. There is no admin registration or promotion endpoint. This is operational but means admin creation requires DB access.

---

## 10. Resource Processing & Storage Audit

**Upload flow:** `POST /api/resources/upload` (faculty only) → multer disk storage → insert resource `status='queued'` → Bull job `process-resource` → worker processes → `status='ready'`.

**Storage:** Local disk `./uploads`. **Ephemeral on Render free tier — all uploads lost on redeploy.** `render.yaml` `UPLOAD_DIR: ./uploads` with comment "Ephemeral storage since disks aren't supported on free tier." This is a **CRITICAL data-loss risk.**

**Processing:** `processor.js` — pdf-parse text extraction → chunking (sliding window, ~512 tokens, 50 overlap) → `embedBatch` (Gemini batchEmbedContents, 768 dims) → insert `resource_chunks` → `generateMetadata` → `status='ready'`.

**Progress:** `resources.progress` and `resources.stage` columns updated during processing. Frontend `UploadCard` polls `/resources/:id/status` every 2s and shows a progress bar. **The progress is real** (DB-backed), not just animation.

**Authorization on resources:** `GET /resources` lists by `subject_offering_id` or `subject_id` with **no ownership check** — any authenticated user can list resources for any offering/subject they guess the ID of. However, `vectorSearch` in RAG applies scope filtering. Download has no authorization check. **Gap: resource list/download not scoped to user's enrollment.**

**Chunk cleanup:** `resource_chunks` has `ON DELETE CASCADE` on `resource_id`. Delete endpoint removes file + DB row → chunks cascade. Good.

**Duplicate uploads:** No duplicate detection. Same file can be uploaded multiple times.

**Failed job recovery:** Bull `attempts: 3`, exponential backoff. `POST /api/resources/:id/process` allows manual re-trigger. If Redis down, queue disabled and resources stay queued until manual trigger (which runs `processResource` inline, non-awaited).

**RAG authorization in vectorSearch:** Student scope filters `subject_offering_id IN (SELECT id FROM subject_offerings WHERE academic_class_id = $4)`. Faculty scope filters by `faculty_id`. Only `status='ready'` chunks returned. **Correct — authorization applied before similarity ranking.**

---

## 11. RAG / AI Audit

**Flow:** `POST /api/ask` → embed query (Gemini) → `vectorSearch` with auth scope + `status='ready'` → relevance threshold (default 0.55) → if no chunks or below threshold → return `"Not in provided material."` → else `generateAnswer` (Gemini) with strict system prompt → citations `[1]`, `[2]` → audit log.

**Models:** `gemini-embedding-2` (embeddings), `gemini-3.5-flash` (generation) per `rag.js`. `llmAdapter.js` defaults to `PROVIDER='mock'` unless `LLM_PROVIDER` set. `render.yaml` sets `LLM_PROVIDER=google` and `GOOGLE_AI_MODEL=gemini-3.5-flash`.

**llmAdapter mismatch:** `rag.js` has its own `generateAnswer` that calls Gemini directly (not via `llmAdapter`). `llmAdapter.js` is a separate pluggable adapter used by... nothing in the routes (ask.js imports `generateAnswer` from `../services/llmAdapter`? Let me check — ask.js line 7: `const { generateAnswer } = require('../services/llmAdapter');` — wait, actually ask.js line 7 imports from llmAdapter, but rag.js also exports generateAnswer. The ask route uses `llmAdapter.generateAnswer`, while rag.js's `generateAnswer` is unused by the route. **Dead/duplicate code path.**

**Fallback:** `"Not in provided material."` is returned exactly when threshold not met. The route also checks LLM output doesn't contain citations → converts to not-found. Good.

**Citations:** Sources include `resourceId`, `filename`, `pageNumber`, `chunkIndex`, `similarity`, `excerpt`. Page numbers are **estimated** (char position / charsPerPage), not actual PDF page mapping. **Imprecise citations.**

**Similarity threshold:** `SIMILARITY_THRESHOLD` env, default 0.55. Enforced in route. Good.

**Rate limit:** `ragLimiter` 10/min. Good.

**Audit logging:** `ai_audit_logs` records query, answer, was_found, similarity, tokens, latency, prompt_hash. Good.

**RAG success with real PDF:** Not demonstrated in this audit (no live service access). Tests mock the RAG services. **Status: IMPLEMENTED, NOT FULLY TESTED against live PDF.**

**Voice/Image/Face:** See section 12.

---

## 12. Attendance Audit

**Flow:** Faculty `POST /attendance/start` (geolocation + offering) → creates session with 6-char hex nonce (30s expiry) → students `POST /attendance/mark` (nonce + geolocation) → backend validates nonce, expiry, enrollment (class/branch/batch/division match), distance ≤ radius → `status='present'` or `rejected` → faculty can end session, view roster, override.

**Nonce:** `crypto.randomBytes(3).toString('hex').toUpperCase()` = 6 hex chars. 30s expiry. Auto-rotates on fetch if expired. Low entropy but short-lived. Reuse possible within 30s window.

**Duplicate prevention:** `UNIQUE(session_id, student_id)` + explicit check → 409.

**Enrollment check:** Student's `academic_class_id` branch/batch/division must match session's offering class. Lab group check for lab sessions. Good.

**Faculty ownership:** `canManageSession` checks `session.faculty_id === user.id` or admin. Good.

**GPS:** Haversine distance. Radius default 50m. Rejected attempts logged with `rejection_reason`. No anti-spoofing (location is client-supplied, can be faked in browser dev tools). **Basic GPS validation only, not robust anti-spoofing.**

**Missing coordinates:** `latitude == null || longitude == null` → 400. Geolocation denial handled in UI with error message.

**Manual override:** Faculty/admin can set present/absent with note via override/roster PUT. `verification_method` set to `faculty_manual`/`admin_override`.

**Audit:** `attendance_records` stores `student_location_hash` (SHA-256 of coords), `device_id`, `verification_method`, `rejection_reason`. Good.

**Status values:** Base schema CHECK `present`/`rejected`; migration_03 adds `absent`. Good.

**Session expiration:** `is_active` boolean + `ended_at`. No automatic timeout — sessions stay active until faculty ends them. Nonce expires but session doesn't. **Minor gap.**

---

## 13. Voice / Image / Face Authentication

### Voice
- `ask.tsx` has a `<Mic>` button in the form. **No onClick handler** — it does nothing.
- No backend speech-to-text endpoint.
- **Status: UI ONLY.**

### Image questions
- `ask.tsx` has `<Camera>` and `<FileText>` (attach) buttons. **No onClick handlers** — they do nothing.
- No backend image upload/OCR/vision endpoint.
- **Status: UI ONLY.**

### Face authentication
- `client/src/routes/_authenticated/face-setup.tsx` — enrollment UI exists (not reviewed in depth).
- `server/src/routes/face.js` `POST /face/match` — **MVP mock**: accepts `imageBase64`, waits 800ms, returns `{ match: true, confidence: 0.98, provider: 'mock-local' }`. No actual matching, no stored embeddings, no liveness, no consent storage beyond a UI flag.
- `client/src/lib/face.ts` `useFaceStatus()` — hook exists.
- AGENTS.md: "Face ID: only enrollment consent/status is stored (face_enrollments); no images are saved. Real matching plugs in later behind request_face_enrollment."
- `face_enrollments` table — **not found in schema.** Not in schema.sql or migrations. **Missing table.**
- **Status: UI ONLY / MOCKED. No real biometric authentication.**

**Privacy:** No biometric data stored. No consent record in DB. No retention/deletion controls. If face matching is added, biometric templates require special handling (encryption at rest, explicit consent, deletion on account deletion).

---

## 14. Performance, Testing, Code Quality

### Tests executed
- `server/` — `npm test`: **10 suites, 65 tests, ALL PASSING.** (Jest + supertest, heavily mocked)
- `client/` — `npm run test`: **1 file, 1 test, PASSING.** (Vitest, app routing)
- `server/` lint: no lint script.
- `client/` lint: **7,701 prettier errors** (CRLF line endings) — formatting only.
- `client/` build: **SUCCESS** after `npm install`. (Vite + Nitro build, ~1.1MB client + SSR)

### Test realism
- Server tests mock `pool`, `rag`, `llmAdapter`, `auth` middleware. **Unit-level, not integration.** They verify route logic with fake DB responses, not real database behavior.
- `server/e2e_test.js` hits the live Render URL but is not part of `npm test` (it's a standalone script). Not executed in this audit (no live access / would modify production data).
- No browser-based E2E (Playwright/Cypress).
- No load/performance tests.

### Code quality observations
- Backend is CommonJS JS, not TypeScript. No type safety.
- `ask.js` imports `generateAnswer` from `llmAdapter` but `rag.js` also has `generateAnswer` — duplicate/confusing.
- `resources.js` has duplicate route definitions: `GET /:id/status` defined twice (lines 152 and 204). Second overrides first. Harmless but sloppy.
- `resources.js` download endpoint returns 404 text "File is no longer available in ephemeral storage..." — honest about the limitation.
- `server/src/index.js` global error handler returns 500 with no details (good) but multer errors expose `err.stack` in upload response (line 109) — minor info leak.
- ~7,700 prettier errors are CRLF-only — cosmetic.
- `client/src/lib/firebase-analytics.ts` and `firebase.functions.ts` exist; Firebase initialized in `__root.tsx`. Unclear if Firebase is actually used for anything beyond analytics.

### Performance risks
- PDF processing reads entire file into memory (`fs.readFileSync`) — large PDFs could OOM.
- Embedding batch of 100 — Gemini rate limits may apply.
- Vector search uses IVFFlat with `lists=100` — needs retraining as data grows; no HNSW.
- No pagination on `/admin/users`, `/admin/logs` has pagination, `/resources` has no pagination (unbounded list).
- No response caching.
- N+1 risk: `GET /subjects` runs subqueries per row for resource_count and faculty_name. Small scale OK.

---

## 15. UI / Accessibility / Mobile

Not browser-tested in this audit (no live frontend access, no browser automation). Static inspection only.

- **Responsive:** Tailwind CSS, `max-w-xl`/`max-w-3xl` containers, bottom nav. Should work on mobile but not verified.
- **Fixed navigation overlap:** Bottom nav (`bottom-4`) and floating Ask Snippet (`bottom-24`) could overlap on small screens. Not verified.
- **Touch targets:** Radix primitives generally accessible. Not verified.
- **Keyboard nav:** Not verified.
- **Contrast:** Custom design tokens (`bg-ai`, `glass`, etc.). Not verified.
- **Loading/skeleton states:** Some (upload progress, attendance ring). Home has no skeleton.
- **Empty states:** Present on resources, attendance history.
- **Modal behavior:** Not extensively reviewed.
- **Long text/filenames:** `truncate` classes used. Not verified.
- **Horizontal overflow:** Not verified.

---

## 16. Security Findings

### SECR-01: No logout / token revocation (CRITICAL, CONFIRMED)
- **File:** `server/src/routes/auth.js` (no logout route), `client/src/lib/api.ts` (no logout action)
- **Evidence:** No `/auth/logout` endpoint. Refresh tokens valid until 7d expiry. No blacklist.
- **Consequence:** Stolen refresh tokens remain valid; user cannot invalidate sessions.
- **Fix:** Add logout endpoint that invalidates refresh token; consider short refresh expiry or rotation.

### SECR-02: Resource download has no authorization check (HIGH, CONFIRMED)
- **File:** `server/src/routes/resources.js` line 277-294 (`GET /:id/download`)
- **Evidence:** Only `authenticate` middleware; no check that user is enrolled in the resource's subject/offering.
- **Consequence:** Any authenticated user can download any resource by guessing ID.
- **Fix:** Add enrollment/ownership check before `res.download`.

### SECR-03: Resource list has no authorization scoping (HIGH, CONFIRMED)
- **File:** `server/src/routes/resources.js` lines 114-149
- **Evidence:** `GET /resources` filters by `subject_offering_id`/`subject_id` only, no user-scope check.
- **Consequence:** Users can list resources for classes they're not enrolled in (if they know the ID).
- **Fix:** Scope list to user's enrolled classes/offerings.

### SECR-04: Email case-sensitivity unique constraint bug (HIGH, CONFIRMED)
- **File:** `server/src/routes/auth.js` line 168, `server/src/db/schema.sql` line 47
- **Evidence:** Registration checks `lower(trim(email))` but DB `email` column is UNIQUE case-sensitively. `A@ustu.edu.in` and `a@ustu.edu.in` pass app check but collide at DB level → 500.
- **Consequence:** Registration crash / account enumeration edge case.
- **Fix:** Store email lowercased; use citext or lowercase unique index.

### SECR-05: No rate limit on resource upload (MEDIUM, UNVERIFIED)
- **File:** `server/src/routes/resources.js` line 37
- **Evidence:** Upload route uses `authLimiter`? No — it uses `authenticate, authorize('faculty')` only. `apiLimiter` (100/15min) applies globally but is loose for file upload.
- **Consequence:** Potential abuse / disk fill.
- **Fix:** Add stricter upload rate limit.

### SECR-06: Tokens in localStorage (MEDIUM, CONFIRMED)
- **File:** `client/src/lib/api.ts`
- **Evidence:** `snippet_token`, `snippet_refresh_token` in localStorage.
- **Consequence:** XSS theft of tokens.
- **Fix:** HttpOnly cookies (requires backend set-cookie changes).

### SECR-07: Face match is unauthenticated mock returning always-true (HIGH, CONFIRMED)
- **File:** `server/src/routes/face.js` lines 23-35
- **Evidence:** `match: true` hardcoded, no image validation, no enrollment check beyond authenticate.
- **Consequence:** If wired to attendance, anyone passes face auth.
- **Fix:** Implement real matching or disable until ready.

### SECR-08: CORS allows all *.vercel.app (MEDIUM, CONFIRMED)
- **File:** `server/src/index.js` line 24
- **Evidence:** Regex `/^https:\/\/.*\.vercel\.app$/` allows any Vercel subdomain.
- **Consequence:** Less restrictive than needed.
- **Fix:** Allowlist specific Vercel preview URLs.

---

## 17. Limitations & Missing Requirements

### Functional (non-security)

| ID | Severity | Confidence | Summary |
|----|----------|------------|---------|
| LIM-01 | CRITICAL | CONFIRMED | Uploads on ephemeral disk — lost on redeploy |
| LIM-02 | CRITICAL | CONFIRMED | Background worker not deployed separately (Render) |
| LIM-03 | HIGH | CONFIRMED | Deployment broken (Vercel 404, Render health 404) |
| LIM-04 | HIGH | CONFIRMED | Profile edit UI missing / disconnected |
| LIM-05 | HIGH | CONFIRMED | No logout endpoint |
| LIM-06 | MEDIUM | CONFIRMED | Face match is mock (always true) |
| LIM-07 | MEDIUM | CONFIRMED | Voice/image inputs are non-functional buttons |
| LIM-08 | MEDIUM | CONFIRMED | `subject_id` vs `subject_offering_id` inconsistency on resources |
| LIM-09 | MEDIUM | CONFIRMED | `subject_enrollments` table unused; implicit enrollment only |
| LIM-10 | MEDIUM | UNVERIFIED | No admin provisioning path (DB insert required) |
| LIM-11 | LOW | CONFIRMED | No pagination on `/resources`, `/admin/users` |
| LIM-12 | LOW | CONFIRMED | Attendance sessions don't auto-expire |
| LIM-13 | LOW | CONFIRMED | Page numbers in RAG citations are estimated |
| LIM-14 | INFORMATIONAL | CONFIRMED | ~7,700 prettier CRLF lint errors (cosmetic) |

### Missing features
- Notifications/announcements system
- Results/grades module
- Reminders (UI stub only)
- Assignment/deadline tracking
- Real face enrollment table (`face_enrollments` missing from schema)
- Admin analytics/reports
- Search across resources
- Offline support / PWA

---

## 18. Code Cleanup & Maintainability

| Item | File | Status | Safe to delete? |
|------|------|--------|-----------------|
| Duplicate `schema.sql` | root `schema.sql` vs `server/src/db/schema.sql` | Duplicate (root is older, missing migrations) | Yes, root copy |
| Unused `migration_01.sql` | root `migration_01.sql` | Referenced by docker-compose but not applied by init.js | No (compose references it) |
| `generateAnswer` in `rag.js` | `server/src/services/rag.js` | Duplicated by `llmAdapter.js`; unused by ask route | Review before removal |
| Duplicate `GET /:id/status` | `server/src/routes/resources.js` lines 152 & 204 | Second overrides first | Remove duplicate |
| Supabase directory | `client/supabase/` | Leftover, no Supabase client imports in reviewed routes | Verify before removal |
| Firebase files | `client/src/lib/firebase-analytics.ts`, `firebase.functions.ts` | Additive per AGENTS.md; unclear actual usage | Verify before removal |
| `drizzle-kit`/`drizzle-orm` | `client/package.json` | `drizzle.config.ts` exists but unused (raw SQL in backend) | Remove if unused |
| `e2e_test.js` | `server/e2e_test.js | Hits live production, mutates data | Keep but don't run against prod |
| CRLF line endings | All client files | 7,700 prettier errors | Run `prettier --write` |
| `index.js` root | root `index.js` | Unused stub | Verify |
| `curl_out.txt`, `extract_apis.js`, etc. | root | Audit artifacts | Keep for reference |

---

## 19. Production Readiness Assessment

**NOT production-ready.**

Blocking issues:
1. Frontend deployment broken (404).
2. Backend `/api/health` 404 (per integration report).
3. Uploads lost on every redeploy (ephemeral disk).
4. No dedicated worker — resource processing unreliable.
5. No logout / token revocation.
6. Resource download/list not authorized.

If these were fixed, the core auth → subjects → resources → RAG → attendance flow would be functional for a small single-institution pilot.

---

## 20. Prioritized Remediation Plan

See `REMEDIATION_ROADMAP.md` for full staged plan (P0–P5).

---

## 21. New Feature Recommendations

See `REMEDIATION_ROADMAP.md` section P4–P5. Highest value after P0/P1 fixes:
1. Persistent object storage (S3-compatible) for uploads.
2. Real face matching with `face_enrollments` table + consent.
3. Voice STT + image vision for Ask Snippet.
4. Notifications/announcements.
5. Results/grades module.

---

## 22. Unverified Assumptions & External Dependencies

- Live backend URL `https://snippet-api-pf9m.onrender.com` — unverified (health 404 per report).
- Live frontend URL `https://client-phi-lake.vercel.app` — unverified (404 per report).
- SMTP email delivery — not configured in this audit; registration returns 503 without it.
- `GOOGLE_AI_API_KEY` — not verified; RAG calls would fail without it.
- `JWT_SECRET` — Render auto-generates; not verified.
- Production database contents — not inspected (no credentials access).
- No browser-based testing performed — all frontend findings are static code review only.

---

**End of REPO_AUDIT_REPORT.md.** See sibling files `API_CONTRACT_AUDIT.md`, `FEATURE_STATUS_MATRIX.md`, `REMEDIATION_ROADMAP.md`, `AUDIT_TEST_RESULTS.md`.
