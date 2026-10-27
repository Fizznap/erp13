# Snippet — Feature Status Matrix

**Repository:** `S:\ERP`
**Audit date:** Sun Oct 25 2026
**Status:** AUDIT ONLY

Status definitions:
- **IMPLEMENTED AND VERIFIED** — Code exists and was confirmed by executed tests or static trace.
- **IMPLEMENTED, NOT FULLY TESTED** — Code exists; not verified against live service.
- **PARTIALLY IMPLEMENTED** — Core exists but significant gaps remain.
- **UI ONLY** — Frontend screens/buttons exist; no real backend integration.
- **MOCKED** — Endpoint/UI returns hardcoded/simulated data.
- **BROKEN** — Known broken in production deployment.
- **MISSING** — Not implemented at all.
- **NOT APPLICABLE** — Not part of intended scope.

---

## Feature Matrix

| # | Feature | Intended behavior | Actual implementation | Frontend status | Backend status | DB support | Test status | Limitations | Missing work | File refs | Status |
|---|---------|-------------------|----------------------|-----------------|----------------|------------|-------------|-------------|--------------|---------|--------|
| 1 | Authentication (email/password) | Register, login, verify email, JWT session | Fully implemented; bcrypt 12 rounds; JWT access 15m / refresh 7d; email verification required | Complete UI in `auth.tsx` | Complete in `auth.js` | `users` table | Unit tests pass (mocked DB) | No logout; tokens in localStorage; case-sensitivity unique email bug | Add logout; HttpOnly cookies | `client/src/routes/auth.tsx`, `server/src/routes/auth.js` | IMPLEMENTED, NOT FULLY TESTED |
| 2 | Google OAuth | Sign in with managed college Google account | Implemented; verifies ID token, `hd` domain, auto-creates account | Google button in `auth.tsx` | Complete in `auth.js` + `googleIdentity.js` | `user_auth_identities` | Not tested | Requires `GOOGLE_CLIENT_ID` env | None | `server/src/services/googleIdentity.js` | IMPLEMENTED, NOT FULLY TESTED |
| 3 | Email verification | Verify college email before login | Implemented; SMTP token-based, 24h expiry | Resend button in `auth.tsx` | Complete in `auth.js` + `emailVerification.js` | `users.email_verification_*` | Not tested | Registration returns 503 if SMTP unconfigured | None | `server/src/services/emailVerification.js` | IMPLEMENTED, NOT FULLY TESTED |
| 4 | Token refresh | Rotate access token using refresh token | Implemented | Automatic in `api.ts` 401 handler | Complete in `auth.js:375` | — | Not tested | No rotation/revocation | Add refresh token rotation | `server/src/routes/auth.js`, `client/src/lib/api.ts` | IMPLEMENTED, NOT FULLY TESTED |
| 5 | Logout | Invalidate session | **Missing** | No logout UI/action | No route | — | None | Refresh tokens valid until 7d expiry | Add logout endpoint + revocation | — | MISSING |
| 6 | Current user / profile | Load `me` with profile + onboarding status | Implemented | `useMe()` hook, `/auth/me` | Complete in `auth.js:410` | `users` + `user_profiles` | Not tested | — | None | `client/src/hooks/use-auth.ts` | IMPLEMENTED, NOT FULLY TESTED |
| 7 | Profile editing | Update own profile fields | Backend complete; frontend form disconnected | `ProfileForm.tsx` exists; edit button reportedly commented out | `PATCH /auth/me` complete | `user_profiles` | Not tested | Frontend not reachable | Reconnect edit form | `server/src/routes/auth.js:622`, `client/src/components/snippet/ProfileForm.tsx` | PARTIALLY IMPLEMENTED |
| 8 | Profile photo upload | Upload JPEG/PNG/WebP stored in Postgres | Implemented (BYTEA in `user_avatars`) | `useAvatarUrl`, `profile.tsx` | `PUT/GET/DELETE /auth/avatar` | `user_avatars` | Not tested | 2MB limit; stored in DB (good for ephemeral Render) | None | `server/src/routes/auth.js:444`, `client/src/lib/avatar.ts` | IMPLEMENTED, NOT FULLY TESTED |
| 9 | Student ID card + QR | Digital ID with scannable verify URL | Implemented; QR links to `/verify/$studentNo` | `profile.tsx` | `GET /verify/:studentNo` (public route) | — | Not tested | Verify route is public read-only | None | `client/src/routes/_authenticated/profile.tsx`, `client/src/routes/verify.$studentNo.tsx` | IMPLEMENTED, NOT FULLY TESTED |
| 10 | Academic hierarchy CRUD | Branches, batches, divisions, semesters, classes, lab groups | Implemented (admin only) | `AcademicAdmin.tsx`, `admin.tsx` | Complete in `academic.js` | `branches`, `batches`, `divisions`, `semesters`, `academic_classes`, `academic_lab_groups` | Not tested (e2e hits live prod) | `subject_offerings` UNIQUE excludes `faculty_id` (no team teaching) | None | `server/src/routes/academic.js` | IMPLEMENTED, NOT FULLY TESTED |
| 11 | Subject management | Create subjects; bind to class+faculty as offerings | Implemented | `subjects.$subjectId.tsx`, `resources.tsx` selector | Complete in `subjects.js` | `subjects`, `subject_offerings` | Not tested | Offering unique constraint excludes faculty_id | None | `server/src/routes/subjects.js` | IMPLEMENTED, NOT FULLY TESTED |
| 12 | Student onboarding | Complete profile with class + lab group | Implemented | `complete-profile.tsx` | `POST /auth/complete-profile` | `user_profiles`, `users.academic_class_id` | Not tested | Roll-number validation ties to branch/admission year | None | `client/src/routes/complete-profile.tsx` | IMPLEMENTED, NOT FULLY TESTED |
| 13 | Resource upload (PDF) | Faculty uploads PDF; status queued | Implemented; multer disk storage; 20MB; PDF-only | `resources.tsx` UploadCard | Complete in `resources.js:37` | `resources` | Not tested | Ephemeral disk (data loss on redeploy); no virus scan | Persistent object storage | `server/src/routes/resources.js` | PARTIALLY IMPLEMENTED |
| 14 | Resource processing | PDF → text → chunks → embeddings → ready | Implemented; runs via Bull queue or inline | Status polling + progress bar in `resources.tsx` | `processor.js`, `queue.js` | `resource_chunks` | Not tested | Worker not deployed separately on Render; large PDFs OOM risk | Dedicated worker; object storage | `server/src/services/processor.js` | PARTIALLY IMPLEMENTED |
| 15 | Resource list/download | List by offering; download file | Implemented | `resources.tsx` list + download blob | `resources.js:114`, `resources.js:277` | `resources` | Not tested | **No enrollment scoping on list/download**; ephemeral file loss | Add authorization scoping | `server/src/routes/resources.js` | PARTIALLY IMPLEMENTED |
| 16 | Resource status/progress | Poll processing progress | Implemented; DB-backed progress/stage | Progress bar in UploadCard | `GET /resources/:id/status` | `resources.progress`, `.stage` | Not tested | Progress is real (not animation) | None | `server/src/routes/resources.js:152` | IMPLEMENTED, NOT FULLY TESTED |
| 17 | Ask Snippet (RAG) | Ask question; grounded answer + citations | Implemented; Gemini embedding + generation; auth-scoped vector search; threshold fallback | `ask.tsx` real UI + API | `ask.js`, `rag.js`, `llmAdapter.js` | `resource_chunks`, `ai_audit_logs` | Unit tests mocked (65 pass) | `llmAdapter` provider defaults to `mock`; page numbers estimated; duplicate `generateAnswer` in `rag.js` unused | Verify with real PDF; fix page mapping; deduplicate | `server/src/routes/ask.js`, `server/src/services/rag.js` | IMPLEMENTED, NOT FULLY TESTED |
| 18 | Conversation history | View past RAG queries | Implemented; `ai_audit_logs` | Not exposed in UI (ask.tsx doesn't show history) | `GET /ask/history` | `ai_audit_logs` | Not tested | No frontend history UI | Add history view | `server/src/routes/ask.js:184` | PARTIALLY IMPLEMENTED |
| 19 | Attendance (nonce + GPS) | Faculty starts session; students mark by code + location | Implemented | `attendance.tsx`, `faculty.tsx` | Complete in `attendance.js` | `attendance_sessions`, `attendance_records` | Unit tests (haversine only) | Nonce 6-char low entropy; no auto session expiry; client GPS spoofable; no anti-spoofing | Add liveness/anti-spoofing; session TTL | `server/src/routes/attendance.js` | IMPLEMENTED, NOT FULLY TESTED |
| 20 | Faculty attendance console | Start/end session; show nonce; manage roster | Implemented | `faculty.tsx` | `attendance.js` | — | Not tested | Polls nonce every 10s | None | `client/src/routes/_authenticated/faculty.tsx` | IMPLEMENTED, NOT FULLY TESTED |
| 21 | Admin stats/users/logs | Platform stats; user list; AI logs | Implemented | `admin.tsx` (partial — only users) | `admin.js` | `ai_audit_logs` | Not tested | No pagination on users; no analytics | Add pagination/analytics | `server/src/routes/admin.js` | IMPLEMENTED, NOT FULLY TESTED |
| 22 | Face enrollment | Enroll face for auth/attendance | **UI only** | `face-setup.tsx` exists | No enroll endpoint | `face_enrollments` table **missing** | None | No table, no consent storage, no template storage | Add table + consent + enrollment flow | `client/src/routes/_authenticated/face-setup.tsx` | UI ONLY |
| 23 | Face matching | 1:1 face match | **Mocked** | — | `POST /face/match` returns `match: true` always | — | None | Always returns success; no real matching | Implement real provider or disable | `server/src/routes/face.js` | MOCKED |
| 24 | Voice input | Speech-to-text for questions | **UI only** | `<Mic>` button in `ask.tsx`, no handler | No endpoint | — | None | Button does nothing | Add STT endpoint + frontend wiring | `client/src/routes/_authenticated/ask.tsx` | UI ONLY |
| 25 | Image questions | Upload/capture image; OCR/vision Q&A | **UI only** | `<Camera>` + `<FileText>` buttons in `ask.tsx`, no handlers | No endpoint | — | None | Buttons do nothing | Add vision endpoint + frontend wiring | `client/src/routes/_authenticated/ask.tsx` | UI ONLY |
| 26 | Reminders | Reminder notifications | **UI only** | `reminders.tsx` stub | No endpoint | — | None | Stub only | Implement reminders | `client/src/routes/_authenticated/reminders.tsx` | UI ONLY |
| 27 | Notifications/announcements | Feed of announcements | **Mocked** | Home feed hardcoded (`feed` array in `index.tsx`) | No endpoint | — | None | Feed is static mock data | Implement notifications service | `client/src/routes/_authenticated/index.tsx` | MOCKED |
| 28 | Home dashboard | Student/faculty home with quick links | **Partially mocked** | `index.tsx`; schedule/feed/attendance hardcoded | No dedicated endpoint | — | Not tested | Schedule/feed/attendance % are hardcoded mocks | Connect to real APIs | `client/src/routes/_authenticated/index.tsx` | PARTIALLY IMPLEMENTED |
| 29 | Results / grades | View academic results | **Missing** | No route | No endpoint | No table | None | Not implemented | Build results module | — | MISSING |
| 30 | Assignments/deadlines | Track assignments | **Missing** | No route | No endpoint | No table | None | Not implemented | Build assignments module | — | MISSING |
| 31 | Admin analytics/reports | Reports and audit logs | **Partial** | `admin.tsx` shows users only | `GET /admin/logs`, `GET /admin/stats` | `ai_audit_logs` | Not tested | No charts/export | Add analytics | `server/src/routes/admin.js` | PARTIALLY IMPLEMENTED |
| 32 | Search across resources | Full-text/vector search | **Partial** | RAG provides semantic search only | Vector search in `rag.js` | `resource_chunks` | Not tested | No keyword search; RAG-only | Add keyword/hybrid search | `server/src/services/rag.js` | PARTIALLY IMPLEMENTED |
| 33 | Mobile responsive UI | Work on 320–430px + tablet | **Unverified** | Tailwind + Radix; `max-w-xl`/`max-w-3xl` | — | — | Not browser-tested | Bottom nav + floating button may overlap on small screens | Browser test on multiple widths | `client/src/components/snippet/AppShell.tsx` | NOT VERIFIED |
| 34 | Accessibility | Keyboard nav, contrast, touch targets | **Unverified** | Radix primitives | — | — | Not tested | Not audited | Run a11y audit | — | NOT VERIFIED |
| 35 | Deployment (frontend) | Vercel build + deploy | **BROKEN** | Build succeeds locally | — | — | Build passes | Vercel auto-detected Next.js; 404 in prod per integration report | Fix Vercel framework preset | `client/vercel.json` | BROKEN |
| 36 | Deployment (backend) | Render API + health | **BROKEN** | — | `npm run db:init && node src/index.js` | — | Not tested | `/api/health` 404 per integration report; start runs db:init every restart | Fix Render deploy; separate worker | `render.yaml` | BROKEN |
| 37 | Background worker | Process resource jobs | **Not deployed separately** | — | `worker.js` + Bull queue | — | Not tested | `render.yaml` has no worker service; runs inline in API process if Redis up | Deploy dedicated worker | `server/src/services/worker.js`, `render.yaml` | PARTIALLY IMPLEMENTED |
| 38 | File persistence | Survive redeploys | **Missing** | — | `UPLOAD_DIR=./uploads` ephemeral | — | None | Render free disk is ephemeral; all uploads lost | Add S3-compatible storage | `server/src/routes/resources.js:12` | MISSING (for prod) |
| 39 | Rate limiting | Protect auth and RAG | Implemented | — | `rateLimit.js` (api/auth/rag limiters) | — | Not tested | Upload endpoint only has loose `apiLimiter` | Add stricter upload limit | `server/src/middleware/rateLimit.js` | IMPLEMENTED, NOT FULLY TESTED |
| 40 | CORS | Allow frontend origin | Implemented | — | `index.js` (CLIENT_URL + *.vercel.app) | — | Not tested | Overly permissive preview allowlist | Narrow allowlist | `server/src/index.js:17` | IMPLEMENTED, NOT FULLY TESTED |

---

## Status Summary

| Status | Count |
|--------|-------|
| IMPLEMENTED AND VERIFIED | 0 |
| IMPLEMENTED, NOT FULLY TESTED | 16 |
| PARTIALLY IMPLEMENTED | 8 |
| UI ONLY | 4 |
| MOCKED | 3 |
| BROKEN | 2 |
| MISSING | 3 |
| NOT VERIFIED | 3 |
| NOT APPLICABLE | 0 |

**No feature is "IMPLEMENTED AND VERIFIED" against live production services.** All confirmed-working features rely on unit tests with mocked dependencies or static code review, not live end-to-end verification.

**Files referenced:**
- `client/src/lib/api.ts` — API client + token refresh
- `server/src/routes/auth.js` — auth routes
- `server/src/routes/resources.js` — resource routes
- `server/src/routes/ask.js` — RAG route
- `server/src/routes/attendance.js` — attendance routes
- `server/src/routes/academic.js` — hierarchy routes
- `server/src/routes/subjects.js` — subject routes
- `server/src/routes/admin.js` — admin routes
- `server/src/routes/face.js` — face route (mock)
- `server/src/services/processor.js` — PDF processing
- `server/src/services/rag.js` — RAG service
- `server/src/jobs/queue.js` — Bull queue
- `server/src/db/schema.sql` — database schema
- `client/src/routes/_authenticated/` — authenticated routes
- `client/src/components/snippet/` — shared components

**End of FEATURE_STATUS_MATRIX.md.**
