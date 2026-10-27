# Snippet — Remediation Roadmap

**Repository:** `S:\ERP`
**Audit date:** Sun Oct 25 2026
**Status:** AUDIT ONLY — no changes made

Effort estimates are rough engineering estimates (SMALL < 1 day, MEDIUM 1–3 days, LARGE 3–10 days), not promises. All regression tests should be run against a local staging database, never production.

---

## P0 — Critical security, data-loss, and deployment risks

### P0-1: Fix frontend deployment (Vercel 404)
- **Problem:** Vercel auto-detected Next.js instead of Vite; production frontend serves 404/default page. (Per `integration_verification_report.md`)
- **Required work:** Set Vercel project framework preset to Vite; build command `npm run build`; output directory `.output/public`; env `VITE_API_URL`.
- **Effort:** SMALL
- **Dependencies:** Vercel project access.
- **Acceptance criteria:** `https://client-phi-lake.vercel.app` (or current prod domain) serves the built Snippet app; `/` renders Home.
- **Regression tests:** `npm run build` succeeds locally; page loads in browser.

### P0-2: Fix backend deployment (Render `/api/health` 404)
- **Problem:** Render backend `/api/health` returns 404 — latest API code not deployed or wrong service URL.
- **Required work:** Investigate Render deploy logs; ensure `rootDir: server`, build `npm ci --production`, start `npm run db:init && node src/index.js`; verify route registration in `server/src/index.js`.
- **Effort:** SMALL–MEDIUM
- **Dependencies:** Render service access.
- **Acceptance criteria:** `GET /api/health` returns `{ status: "ok" }`; `GET /api/health/db` returns table/column info.
- **Regression tests:** Health endpoint responds 200.

### P0-3: Persistent file storage for uploads (ephemeral disk data loss)
- **Problem:** `UPLOAD_DIR=./uploads` on Render free tier is ephemeral — all uploaded PDFs lost on every redeploy/restart. (`render.yaml`, `server/src/routes/resources.js:12`)
- **Required work:** Replace local disk multer storage with S3-compatible object storage (or Render Disk if available on paid tier). Store object key instead of local file path. Update download endpoint to stream from object storage with signed URLs.
- **Effort:** MEDIUM
- **Dependencies:** Object storage bucket + credentials (`S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`).
- **Acceptance criteria:** Uploaded file survives a redeploy; download returns correct bytes; file deleted when resource deleted.
- **Regression tests:** Upload then simulate restart; file still accessible.

### P0-4: Add logout endpoint + token revocation
- **Problem:** No `/auth/logout`; refresh tokens valid until 7d expiry; no blacklist/rotation. Stolen tokens remain usable.
- **Required work:** Add `POST /auth/logout` that invalidates the refresh token (e.g., store revoked token jti/exp in a `revoked_tokens` table or shorten refresh expiry + rotate). Add frontend logout action that calls it and clears localStorage.
- **Effort:** MEDIUM
- **Dependencies:** DB table for revoked tokens (or Redis).
- **Acceptance criteria:** After logout, refresh token rejected; frontend clears tokens and redirects to `/auth`.
- **Regression tests:** Logout then attempt refresh → 401.

### P0-5: Authorize resource download and list
- **Problem:** `GET /resources/:id/download` and `GET /resources` check only authentication, not enrollment/ownership. Any authenticated user can download/list any resource by ID.
- **Required work:** Add enrollment/ownership check in download route (user must be enrolled in the resource's subject offering or be the uploader/admin). Scope resource list to user's enrolled classes/offerings.
- **Effort:** MEDIUM
- **Dependencies:** None.
- **Acceptance criteria:** Student cannot download resource from a class they're not enrolled in (403); list returns only scoped resources.
- **Regression tests:** Cross-class download attempt → 403.

---

## P1 — Broken existing core workflows

### P1-1: Fix email case-sensitivity unique constraint bug
- **Problem:** Registration normalizes email with `lower(trim(email))` for the app check, but DB `email` unique constraint is case-sensitive. `A@x.com` and `a@x.com` pass app check but collide at DB level → 500.
- **Required work:** Store email lowercased at insert; add a lowercase unique index or use `citext`. Update registration/login/verify queries to use `lower(trim(email))`.
- **Effort:** SMALL
- **Dependencies:** Migration to lowercase existing emails + unique index.
- **Acceptance criteria:** Registering `A@ustu.edu.in` then `a@ustu.edu.in` → second returns 409 "Email already registered", not 500.
- **Regression tests:** Registration with case variants.

### P1-2: Connect profile edit form (frontend)
- **Problem:** Backend `PATCH /auth/me` complete but frontend edit button reportedly commented out; `ProfileForm.tsx` not reachable.
- **Required work:** Restore edit entry in `profile.tsx` wired to `PATCH /auth/me` via `ProfileForm`; refresh `useMe` on save.
- **Effort:** SMALL
- **Dependencies:** None.
- **Acceptance criteria:** User can open profile edit, change allowed fields, save, see updated values.
- **Regression tests:** Edit profile → `GET /auth/me` reflects changes.

### P1-3: Dedicated background worker on Render
- **Problem:** `render.yaml` has no `worker` service. Resource processing runs inline in API process (if Redis up) or stays queued forever. Processing large PDFs in the API process risks timeouts/OOM.
- **Required work:** Add a Render worker service (or background worker plan) running `node src/services/worker.js`; ensure `REDIS_URL` is provided; set queue concurrency.
- **Effort:** MEDIUM
- **Dependencies:** Redis service (already in `render.yaml`).
- **Acceptance criteria:** Upload triggers job; worker picks it up; resource reaches `status='ready'` without blocking API.
- **Regression tests:** Upload PDF → status polls to `ready` within a few minutes.

### P1-4: Add stricter upload rate limit
- **Problem:** Resource upload only covered by global `apiLimiter` (100/15min). No file-specific limit; potential disk/abuse.
- **Required work:** Add `uploadLimiter` (e.g., 10/15min per IP/user) applied to `POST /resources/upload`.
- **Effort:** SMALL
- **Dependencies:** None.
- **Acceptance criteria:** >10 uploads in 15min → 429.
- **Regression tests:** Rate-limit test.

### P1-5: Fix duplicate `GET /:id/status` route in resources.js
- **Problem:** `resources.js` defines `GET /:id/status` twice (lines 152 and 204). Second overrides first; sloppy but functionally the second is a subset of the first.
- **Required work:** Remove duplicate route definition.
- **Effort:** SMALL
- **Dependencies:** None.
- **Acceptance criteria:** Route loads cleanly; no duplicate-route warnings.
- **Regression tests:** Server starts without errors.

---

## P2 — Incomplete backend/frontend integration

### P2-1: Deduplicate `generateAnswer` (rag.js vs llmAdapter.js)
- **Problem:** `rag.js` exports `generateAnswer` that calls Gemini directly; `ask.js` imports `generateAnswer` from `llmAdapter.js`; `rag.js`'s version is unused by the route. Confusing duplication.
- **Required work:** Choose one implementation (prefer `llmAdapter.js` as the pluggable adapter) and remove/deprecate the other; update imports.
- **Effort:** SMALL
- **Dependencies:** None.
- **Acceptance criteria:** Single `generateAnswer` used by `/ask`; `rag.js` does not export an unused duplicate.
- **Regression tests:** RAG unit tests still pass.

### P2-2: Subject offering / resource `subject_id` consistency
- **Problem:** Resources can be uploaded via legacy `subjectId` path without `subject_offering_id`, creating resources not tied to any offering. Ask filters by `subject_id` + class scope; orphaned resources may not surface correctly.
- **Required work:** Make `subject_offering_id` required on new uploads; backfill or mark legacy resources; ensure `subject_id` on resources always matches the offering's subject.
- **Effort:** MEDIUM
- **Dependencies:** Migration to validate/backfill.
- **Acceptance criteria:** Every resource has a valid `subject_offering_id` matching its `subject_id`.
- **Regression tests:** Upload via offering; verify resource queryable under that offering.

### P2-3: Add attendance session auto-expiry
- **Problem:** Sessions stay `is_active=true` until faculty ends them. Nonce expires after 30s but session lingers, allowing marking after class ends (until nonce rotates).
- **Required work:** Add `expires_at` to `attendance_sessions`; auto-mark inactive on query if past expiry; or faculty-end default timeout.
- **Effort:** SMALL
- **Dependencies:** Schema change (`ALTER TABLE attendance_sessions ADD COLUMN expires_at`).
- **Acceptance criteria:** Session no longer markable after expiry time.
- **Regression tests:** Expired session → mark returns 400/404.

### P2-4: Add pagination to `/admin/users`, `/admin/logs`, `/resources`
- **Problem:** Unbounded lists; `/admin/logs` has pagination but `/admin/users` and `/resources` do not.
- **Required work:** Add `page`/`limit` query params with defaults and caps.
- **Effort:** SMALL
- **Dependencies:** None.
- **Acceptance criteria:** Large datasets return paginated results with total count.
- **Regression tests:** Pagination params respected.

---

## P3 — Performance, UX, accessibility, and maintainability

### P3-1: Fix CRLF lint errors (~7,700 prettier errors)
- **Problem:** All client files use CRLF line endings; prettier flags ~7,701 errors.
- **Required work:** Run `prettier --write` on client; add `.prettierrc` enforcement; consider pre-commit hook.
- **Effort:** SMALL
- **Dependencies:** None.
- **Acceptance criteria:** `npm run lint` reports 0 errors.
- **Regression tests:** Lint passes.

### P3-2: Real face matching (replace mock)
- **Problem:** `POST /face/match` always returns `match: true, confidence: 0.98`. `face_enrollments` table missing from schema.
- **Required work:** Add `face_enrollments` table (user_id, template_hash, consent_at, consent_version); implement real 1:1 matching provider or clearly gate behind feature flag; store consent; add deletion on account removal.
- **Effort:** LARGE
- **Dependencies:** Biometric provider API or local face-recognition library; legal review for biometric data handling.
- **Acceptance criteria:** Match returns real confidence; enrollment requires consent; no images stored (only templates/hashes).
- **Regression tests:** Match known vs unknown faces; enrollment flow end-to-end.

### P3-3: Voice input (STT) for Ask Snippet
- **Problem:** `<Mic>` button in `ask.tsx` does nothing; no STT endpoint.
- **Required work:** Add frontend microphone capture (Web Audio API / `navigator.mediaDevices.getUserMedia`); backend endpoint to receive audio and return text (or use browser Web Speech API); wire into `ask.tsx`.
- **Effort:** MEDIUM
- **Dependencies:** Browser permission; STT service or Web Speech API.
- **Acceptance criteria:** User speaks question; text appears in input; RAG query sent.
- **Regression tests:** Browser mic permission flow.

### P3-4: Image questions (vision/OCR) for Ask Snippet
- **Problem:** `<Camera>` and `<FileText>` buttons do nothing; no image endpoint.
- **Required work:** Add image upload endpoint; OCR/vision extraction (Gemini vision or Tesseract); feed extracted text into RAG context.
- **Effort:** MEDIUM–LARGE
- **Dependencies:** Vision-capable model or OCR service.
- **Acceptance criteria:** User attaches image; text extracted; question answered from image content.
- **Regression tests:** Image with known text → answer cites it.

### P3-5: Citation page-number accuracy
- **Problem:** Page numbers estimated via `charPosition / charsPerPage`, not actual PDF page mapping.
- **Required work:** Use `pdf-parse` page text metadata to map chunks to actual page numbers.
- **Effort:** SMALL
- **Dependencies:** None.
- **Acceptance criteria:** Citations show correct PDF page numbers.
- **Regression tests:** Multi-page PDF; verify page numbers.

---

## P4 — New product capabilities (after P0–P3)

### P4-1: Notifications / announcements
- **User problem:** Students don't know when faculty uploads resources or posts announcements.
- **Benefit:** Engagement, timely communication.
- **Frontend:** Notifications bell + list page.
- **Backend:** `notifications` table; `POST /notifications`, `GET /notifications/my`; trigger on resource upload.
- **DB:** New `notifications` table (user_id, type, title, body, read_at, created_at).
- **Third-party:** None (or email/push later).
- **Security:** User-scoped notifications only.
- **Effort:** MEDIUM
- **Acceptance criteria:** Faculty upload creates notification for enrolled students; student sees unread count; mark read.

### P4-2: Results / grades module
- **User problem:** Students can't view academic results.
- **Benefit:** Core ERP feature.
- **Frontend:** Results view by subject/semester.
- **Backend:** `results` table (student_id, subject_offering_id, marks, grade, published_at); faculty publish endpoint.
- **DB:** New `results` table.
- **Effort:** LARGE
- **Acceptance criteria:** Faculty publishes results; student sees own results only.
- **Regression tests:** Cross-student result access → 403.

### P4-3: Assignments / deadlines
- **User problem:** No assignment tracking.
- **Benefit:** Academic planning.
- **Effort:** LARGE
- **Acceptance criteria:** Faculty creates assignment with due date; student submits file; faculty grades.

### P4-4: Hybrid search (keyword + vector)
- **User problem:** RAG is semantic-only; exact-term searches may miss.
- **Benefit:** Better resource discovery.
- **Effort:** MEDIUM
- **Acceptance criteria:** Keyword search returns relevant chunks alongside vector results.

---

## P5 — Future enhancements

| Item | Effort | Notes |
|------|--------|-------|
| Offline support / PWA | LARGE | Service worker, cached resources |
| Email notifications on upload | MEDIUM | Requires SMTP |
| Push notifications | LARGE | Firebase/APNS |
| Admin analytics dashboard | LARGE | Charts, export |
| Multi-college tenancy | LARGE | Currently single-institution |
| SOC2 / audit logging enhancements | MEDIUM | Admin action audit table |
| Resource sharing across divisions | MEDIUM | Cross-offering visibility controls |

---

## Ordering guidance

1. **P0 first** — deployment, storage, logout, authorization. Without these the app is unsafe and data is at risk.
2. **P1 second** — fix broken core workflows so existing features work reliably.
3. **P2 third** — integration cleanup before building on top of confusing code.
4. **P3 fourth** — UX/performance polish and real AI features (face, voice, image).
5. **P4/P5 last** — new product capabilities only after foundation is solid.

**Do not implement P4+ until P0–P2 are complete and tested.**

**End of REMEDIATION_ROADMAP.md.**
