# Snippet — API Contract Audit

**Repository:** `S:\ERP`
**Audit date:** Sun Oct 25 2026
**Status:** AUDIT ONLY — no changes made

---

## 1. Endpoint Inventory

All backend routes are mounted under `/api` in `server/src/index.js`. Frontend base URL is built in `client/src/lib/api.ts` as `VITE_API_URL + '/api'` (or `http://localhost:3001/api` fallback).

### Authentication

| Method | Path | Auth | Roles | Source file:line |
|--------|------|------|-------|------------------|
| POST | /auth/register | No | — | server/src/routes/auth.js:149 |
| POST | /auth/login | No | — | server/src/routes/auth.js:256 |
| POST | /auth/google | No | — | server/src/routes/auth.js:295 |
| POST | /auth/refresh | No | — | server/src/routes/auth.js:375 |
| GET | /auth/me | Yes (access token) | all | server/src/routes/auth.js:410 |
| PATCH | /auth/me | Yes (access token) | all | server/src/routes/auth.js:622 |
| POST | /auth/verify-email | No | — | server/src/routes/auth.js:194 |
| POST | /auth/verification/resend | No | — | server/src/routes/auth.js:223 |
| GET | /auth/avatar | Yes (access token) | all | server/src/routes/auth.js:444 |
| PUT | /auth/avatar | Yes (access token) | all | server/src/routes/auth.js:460 |
| DELETE | /auth/avatar | Yes (access token) | all | server/src/routes/auth.js:479 |
| GET | /auth/onboarding/options | Yes (onboarding token) | student | server/src/routes/auth.js:490 |
| POST | /auth/complete-profile | Yes (onboarding token) | student | server/src/routes/auth.js:518 |

### Academic

| Method | Path | Auth | Roles | Source file:line |
|--------|------|------|-------|------------------|
| GET | /academic/hierarchy | Yes | all | server/src/routes/academic.js:8 |
| POST | /academic/branches | Yes | admin | server/src/routes/academic.js:55 |
| POST | /academic/batches | Yes | admin | server/src/routes/academic.js:68 |
| POST | /academic/divisions | Yes | admin | server/src/routes/academic.js:81 |
| POST | /academic/semesters | Yes | admin | server/src/routes/academic.js:94 |
| POST | /academic/classes | Yes | admin | server/src/routes/academic.js:107 |
| POST | /academic/lab-groups | Yes | admin | server/src/routes/academic.js:122 |

### Subjects

| Method | Path | Auth | Roles | Source file:line |
|--------|------|------|-------|------------------|
| GET | /subjects | Yes | all | server/src/routes/subjects.js:8 |
| POST | /subjects | Yes | faculty, admin | server/src/routes/subjects.js:85 |
| POST | /subjects/offerings | Yes | admin, faculty | server/src/routes/subjects.js:109 |
| GET | /subjects/:id | Yes | all | server/src/routes/subjects.js:133 |

### Resources

| Method | Path | Auth | Roles | Source file:line |
|--------|------|------|-------|------------------|
| POST | /resources/upload | Yes | faculty | server/src/routes/resources.js:37 |
| GET | /resources | Yes | all | server/src/routes/resources.js:114 |
| GET | /resources/:id | Yes | all | server/src/routes/resources.js:182 |
| GET | /resources/:id/status | Yes | all | server/src/routes/resources.js:152 & 204 (dup) |
| DELETE | /resources/:id | Yes | faculty, admin | server/src/routes/resources.js:220 |
| POST | /resources/:id/process | Yes | faculty, admin | server/src/routes/resources.js:255 |
| GET | /resources/:id/download | Yes | all | server/src/routes/resources.js:277 |

### Ask (RAG)

| Method | Path | Auth | Roles | Source file:line |
|--------|------|------|-------|------------------|
| POST | /ask | Yes | student, faculty | server/src/routes/ask.js:12 |
| GET | /ask/history | Yes | all | server/src/routes/ask.js:184 |

### Attendance

| Method | Path | Auth | Roles | Source file:line |
|--------|------|------|-------|------------------|
| POST | /attendance/start | Yes | faculty | server/src/routes/attendance.js:46 |
| GET | /attendance/:sessionId/nonce | Yes | faculty | server/src/routes/attendance.js:129 |
| POST | /attendance/mark | Yes | student | server/src/routes/attendance.js:162 |
| POST | /attendance/:sessionId/end | Yes | faculty | server/src/routes/attendance.js:313 |
| POST | /attendance/:sessionId/override | Yes | admin, faculty | server/src/routes/attendance.js:332 |
| GET | /attendance/:sessionId/roster | Yes | faculty, admin | server/src/routes/attendance.js:364 |
| PUT | /attendance/:sessionId/roster/:studentId | Yes | faculty, admin | server/src/routes/attendance.js:397 |
| GET | /attendance/sessions | Yes | faculty, admin | server/src/routes/attendance.js:430 |
| GET | /attendance/my/records | Yes | student | server/src/routes/attendance.js:467 |
| GET | /attendance/:sessionId/records | Yes | faculty, admin | server/src/routes/attendance.js:496 |

### Admin

| Method | Path | Auth | Roles | Source file:line |
|--------|------|------|-------|------------------|
| GET | /admin/stats | Yes | admin | server/src/routes/admin.js:8 |
| GET | /admin/users | Yes | admin | server/src/routes/admin.js:35 |
| PATCH | /admin/users/:id | Yes | admin | server/src/routes/admin.js:49 |
| PATCH | /admin/users/:id/class | Yes | admin | server/src/routes/admin.js:74 |
| GET | /admin/logs | Yes | admin | server/src/routes/admin.js:125 |

### Face

| Method | Path | Auth | Roles | Source file:line |
|--------|------|------|-------|------------------|
| POST | /face/match | Yes | all | server/src/routes/face.js:9 |

### Health

| Method | Path | Auth | Roles | Source file:line |
|--------|------|------|-------|------------------|
| GET | /health | No | — | server/src/index.js:32 |
| GET | /health/db | No | — | server/src/index.js:36 |

---

## 2. Frontend → Backend Mapping Table

| Frontend file | Frontend call | HTTP | Backend path | Auth header | Mismatch? |
|---------------|---------------|------|--------------|-------------|-----------|
| `src/routes/auth.tsx` | `api("/auth/register", {method:"POST", body})` | POST | /auth/register | No | No |
| `src/routes/auth.tsx` | `api("/auth/login", {method:"POST", body})` | POST | /auth/login | No | No |
| `src/routes/auth.tsx` | `api("/auth/google", {method:"POST", body:{credential}})` | POST | /auth/google | No | No |
| `src/routes/auth.tsx` | `api("/auth/verify-email", {method:"POST", body:{token}})` | POST | /auth/verify-email | No | No |
| `src/routes/auth.tsx` | `api("/auth/verification/resend", ...)` | POST | /auth/verification/resend | No | No |
| `src/routes/_authenticated/route.tsx` | `api("/auth/me")` | GET | /auth/me | Yes (Bearer) | No |
| `src/hooks/use-auth.ts` | `api("/auth/me")` | GET | /auth/me | Yes (Bearer) | No |
| `src/routes/_authenticated/profile.tsx` | (uses `useMe` → `/auth/me`) | GET | /auth/me | Yes | No |
| `src/routes/_authenticated/profile.tsx` | `ProfileForm` → `PATCH /api/auth/me` (per integration report, button commented out) | PATCH | /auth/me | Yes | **YES — UI form not reachable** |
| `src/lib/avatar.ts` | `apiBlob("/auth/avatar")` | GET | /auth/avatar | Yes (Bearer) | No |
| `src/routes/_authenticated/resources.tsx` | `api("/subjects")` | GET | /subjects | Yes | No |
| `src/routes/_authenticated/resources.tsx` | `api("/resources?subjectOfferingId=...")` | GET | /resources | Yes | No |
| `src/routes/_authenticated/resources.tsx` | `api("/resources/upload", {method:"POST", body:FormData})` | POST | /resources/upload | Yes | No |
| `src/routes/_authenticated/resources.tsx` | `api("/resources/${id}/status")` | GET | /resources/:id/status | Yes | No |
| `src/routes/_authenticated/resources.tsx` | `fetch("${API_BASE}/resources/${id}/download", {headers:{Authorization}})` | GET | /resources/:id/download | Yes | No |
| `src/routes/_authenticated/resources.tsx` | `api("/resources/${id}", {method:"DELETE"})` | DELETE | /resources/:id | Yes | No |
| `src/routes/_authenticated/ask.tsx` | `api("/subjects")` | GET | /subjects | Yes | No |
| `src/routes/_authenticated/ask.tsx` | `api("/ask", {method:"POST", body:{query, subjectId}})` | POST | /ask | Yes | No |
| `src/routes/_authenticated/attendance.tsx` | `api("/attendance/my/records")` | GET | /attendance/my/records | Yes | No |
| `src/routes/_authenticated/attendance.tsx` | `api("/attendance/mark", {method:"POST", body:{nonce, latitude, longitude}})` | POST | /attendance/mark | Yes | **Partial — no sessionId/subjectId sent; backend resolves by nonce** |
| `src/routes/_authenticated/faculty.tsx` | `api("/subjects")` | GET | /subjects | Yes | No |
| `src/routes/_authenticated/faculty.tsx` | `api("/academic/hierarchy")` | GET | /academic/hierarchy | Yes | No |
| `src/routes/_authenticated/faculty.tsx` | `api("/attendance/start", {method:"POST", body:{subjectOfferingId, sessionType, latitude, longitude, radiusMeters, academicLabGroupId}})` | POST | /attendance/start | Yes | No |
| `src/routes/_authenticated/faculty.tsx` | `api("/attendance/${id}/nonce")` | GET | /attendance/:sessionId/nonce | Yes | No |
| `src/routes/_authenticated/faculty.tsx` | `api("/attendance/${id}/end", {method:"POST"})` | POST | /attendance/:sessionId/end | Yes | No |
| `src/routes/_authenticated/faculty.tsx` | `api("/attendance/${id}/roster")` | GET | /attendance/:sessionId/roster | Yes | No |
| `src/routes/_authenticated/faculty.tsx` | `api("/attendance/${id}/roster/${studentId}", {method:"PUT", body:{status, note}})` | PUT | /attendance/:sessionId/roster/:studentId | Yes | No |
| `src/routes/_authenticated/faculty.tsx` | `api("/attendance/sessions?subjectOfferingId=...")` | GET | /attendance/sessions | Yes | No |
| `src/routes/_authenticated/admin.tsx` | `api("/admin/users")` | GET | /admin/users | Yes | No |
| `src/routes/_authenticated/admin.tsx` | `api("/admin/users/${id}", {method:"PATCH", body:{isActive}})` | PATCH | /admin/users/:id | Yes | No |
| `src/routes/_authenticated/ask.tsx` (Camera/Mic buttons) | — | — | — | — | **YES — no backend voice/image endpoints exist** |

---

## 3. Authentication Requirements

| Endpoint | Token type | Role required | Notes |
|----------|-----------|---------------|-------|
| /auth/register | None | — | Public |
| /auth/login | None | — | Public |
| /auth/google | None | — | Public |
| /auth/refresh | None (refresh token in body) | — | Public |
| /auth/verify-email | None | — | Public |
| /auth/verification/resend | None | — | Public |
| /auth/me | Access | any active verified | Re-queries DB each request |
| /auth/me PATCH | Access | any | Self-update only |
| /auth/avatar GET/PUT/DELETE | Access | any | Self only |
| /auth/onboarding/options | Onboarding token | student | Profile incomplete |
| /auth/complete-profile | Onboarding token | student | Profile incomplete |
| /academic/* GET | Access | any | Read-only |
| /academic/* POST | Access | admin | Write |
| /subjects GET | Access | any | Role-scoped results |
| /subjects POST | Access | faculty, admin | |
| /subjects/offerings POST | Access | admin, faculty | |
| /resources/upload | Access | faculty | Ownership verified per-offering |
| /resources GET | Access | any | **No enrollment scoping** (gap) |
| /resources/:id GET | Access | any | No ownership check |
| /resources/:id/download | Access | any | **No enrollment/ownership check** (gap) |
| /resources/:id DELETE | Access | faculty, admin | Faculty only own uploads |
| /resources/:id/process | Access | faculty, admin | |
| /ask POST | Access | student, faculty | RAG scoped to user's class/offerings |
| /ask/history GET | Access | any | User's own logs only |
| /attendance/start | Access | faculty | Ownership of offering verified |
| /attendance/mark | Access | student | Enrollment verified |
| /attendance/:sessionId/* | Access | faculty, admin | Session ownership verified |
| /attendance/my/records | Access | student | Own records only |
| /admin/* | Access | admin | |
| /face/match | Access | any | Mock implementation |

---

## 4. Payloads & Response Shapes

### POST /auth/register
**Request:** `{ email: string, password: string, fullName: string }`
**Response (202):** `{ message: "Check your college email..." }`
**Errors:** 400 missing fields, 403 non-college email, 409 duplicate

### POST /auth/login
**Request:** `{ email: string, password: string }`
**Response (200):** `{ user: {...}, accessToken: string, refreshToken: string|null, requiresOnboarding: boolean }`
**Errors:** 401 invalid credentials, 403 deactivated / unverified

### POST /auth/google
**Request:** `{ credential: string }` (Google ID token)
**Response:** same as login shape
**Errors:** 403 config/not eligible, 401 invalid token

### POST /auth/refresh
**Request:** `{ refreshToken: string }`
**Response (200):** `{ accessToken: string, refreshToken: string }`
**Errors:** 401 invalid, 403 incomplete/unverified

### GET /auth/me
**Response (200):** `{ user: { id, email, fullName, role, isActive, academicClassId, createdAt, profile: {...}, profileComplete: boolean }, requiresOnboarding: boolean }`

### PATCH /auth/me
**Request:** Partial `{ fullName?, password?, preferredName?, collegeId?, program?, rollNumber?, yearOfStudy?, admissionYear?, expectedGraduationYear?, phone?, bio?, skills?, interests?, achievements?, linkedinUrl?, githubUrl?, portfolioUrl? }`
**Blocked fields:** email, role, academicClassId, collegeId, program, rollNumber, admissionYear → 400
**Response:** `{ user: {...} }`

### POST /resources/upload
**Request (multipart):** `file` (PDF, ≤20MB), `subjectOfferingId` or `subjectId`, `kind`
**Response (201):** `{ resource: { id, subject_id, subject_offering_id, filename, original_name, status: 'queued', progress, stage, ... } }`

### GET /resources
**Query:** `subjectOfferingId` or `subjectId` (required)
**Response:** `{ resources: [{ id, subject_id, subject_offering_id, filename, original_name, file_size, status, summary, key_topics, bullet_points, page_count, chunk_count, created_at, processed_at }] }`

### POST /ask
**Request:** `{ query: string (≤1000 chars), subjectId: string }`
**Response (200):** `{ answer: string, wasFound: boolean, sources: [{ resourceId, resource_name, filename, chunkIndex, pageNumber, similarity, excerpt }], latencyMs, model?, tokensIn?, tokensOut? }`
**Fallback:** `answer: "Not in provided material.", wasFound: false, sources: []`

### POST /attendance/start
**Request:** `{ subjectOfferingId or subjectId, sessionType: 'lecture'|'lab', latitude, longitude, radiusMeters?, academicLabGroupId? }`
**Response (201):** `{ session: { id, active_nonce, nonce_expires, is_active, ... } }`

### POST /attendance/mark
**Request:** `{ sessionId?, subjectOfferingId?, subjectId?, nonce: string, latitude, longitude }`
**Response (200):** `{ status: 'present', distance: number, record: {...} }`
**Errors:** 400 invalid nonce/expired/too far, 403 not enrolled, 409 already marked

### GET /attendance/:sessionId/roster
**Response:** `{ students: [{ student_id, full_name, roll_number, email, status, marked_at, verification_method, rejection_reason }] }`

---

## 5. Frontend ↔ Backend Mismatches

### M-01: Profile edit form disconnected (HIGH, CONFIRMED)
- **Backend:** `PATCH /api/auth/me` fully implemented (`auth.js:622`).
- **Frontend:** `ProfileForm.tsx` exists but per `integration_verification_report.md` the edit button in `profile.tsx` was commented out; the form is not reachable from the UI.
- **Impact:** Users cannot edit profile details despite backend support.

### M-02: Attendance mark lacks session/subject context (MEDIUM, CONFIRMED)
- **Frontend:** `attendance.tsx` sends only `{ nonce, latitude, longitude }`.
- **Backend:** Resolves session by nonce globally (`active_nonce = $1 AND is_active = true`). Works but nonce is only 6 hex chars and not scoped to the student.
- **Impact:** Functionally works but a student who knows another session's nonce could attempt to mark attendance there (enrollment check still applies, so limited risk).

### M-03: Camera/Mic buttons have no backend (MEDIUM, CONFIRMED)
- **Frontend:** `ask.tsx` renders `<Camera>` and `<Mic>` buttons with no onClick handlers.
- **Backend:** No voice STT or image vision endpoints exist.
- **Impact:** Buttons are non-functional UI.

### M-04: `subject_id` vs `subject_offering_id` inconsistency (MEDIUM, CONFIRMED)
- **Resources:** `resources.subject_id` is NOT NULL; `subject_offering_id` is optional. Upload can use legacy `subjectId` path, creating resources not tied to any offering.
- **Ask:** Filters by `subject_id` plus class scope; resources uploaded via legacy path may not appear under offering-scoped queries.
- **Impact:** Data-integrity risk; resources can become orphaned from offerings.

### M-05: No `/auth/logout` endpoint (HIGH, CONFIRMED)
- **Frontend:** No logout action anywhere.
- **Backend:** No logout route, no token revocation.
- **Impact:** Refresh tokens valid until expiry; no session invalidation.

### M-06: Resource download/list not authorized (HIGH, CONFIRMED)
- **Backend:** `GET /resources/:id/download` and `GET /resources` only check authentication, not enrollment/ownership.
- **Impact:** Any authenticated user can list/download any resource by ID.

---

## 6. Missing Endpoints

| Needed endpoint | Reason | Priority |
|-----------------|--------|----------|
| POST /auth/logout | Token revocation / session invalidation | P0 |
| GET /resources/:id/download with enrollment check | Authorization gap | P0 |
| GET /resources with enrollment scoping | Authorization gap | P0 |
| POST /ask/voice (STT) | Voice input currently non-functional | P3 |
| POST /ask/image (vision/OCR) | Image input currently non-functional | P3 |
| POST /face/enroll | Real face enrollment (table missing from schema) | P3 |
| GET /notifications | Notifications/announcements module missing | P4 |
| GET /results | Results/grades module missing | P4 |

---

## 7. Authorization Model Summary

- **Public:** register, login, google, verify-email, resend, health
- **Any authenticated user:** me, me PATCH, avatar, subjects GET, academic hierarchy GET, resources (read, but unscoped), ask/history
- **Faculty only:** resources upload/delete/process, subjects POST, subjects/offerings POST, attendance start/end/roster/override
- **Student only:** attendance mark, attendance/my/records
- **Admin only:** academic POST (all), admin stats/users/logs, admin users PATCH/class
- **Student + Faculty:** ask POST

RAG vector search applies additional scoping: students limited to their `academic_class_id` offerings; faculty limited to their own `faculty_id` offerings; only `status='ready'` chunks.

---

**End of API_CONTRACT_AUDIT.md.**
