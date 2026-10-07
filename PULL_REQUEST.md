# PR: Targeted Fixes for Snippet MVP Robustness

## Overview
This PR implements 10 targeted robustness and resume-grade fixes to ensure the Snippet platform performs reliably in production. It locks the UI to the v0 B&W design system, strengthens the RAG fallback logic against hallucination, implements MVP attendance verification, and introduces comprehensive unit and end-to-end testing.

## Changes

### 1) Improve retrieval + context formatting
- `server/src/services/rag.js`: Restructured LLM prompt context to include numbered chunks with `[N] filename | page | chunk` metadata.
- `server/src/routes/ask.js`: Enforces strict `[N]` citation format in answers and handles fallbacks if missing.

### 2) Raise similarity threshold + fallback logic
- `server/src/routes/ask.js`: Raised `SIMILARITY_THRESHOLD` default to 0.55.
- Implemented robust fallback logic: If top chunk score < 0.55 or average top-K score < 0.55, API instantly returns the strict `NOT_FOUND` message without querying the LLM, reducing latency and costs.

### 3) Store and return rich chunk metadata
- `server/src/db/schema.sql` & `migration_01.sql`: Added `heading` and `resource_name` to `resource_chunks`.
- `server/src/services/processor.js`: Enhanced the chunking engine to detect paragraph boundaries and extract simple heading lines.
- `server/src/routes/ask.js`: API returns rich metadata in `sources` arrays (including `resource_name`).

### 4) Add robust audit logging
- `server/src/db/schema.sql`: Promoted `ai_logs` to `ai_audit_logs`.
- Added critical AI observability fields: `similarity_score` (real), `top_k_scores` (real array), `chunk_ids` (uuid array), `prompt_hash`, `provider`, and `response_time_ms`.
- Instrumented `/api/ask` route to capture and persist these metrics on every query.

### 5) Update chunking strategy & metadata extraction
- `server/src/services/processor.js`: Refined sliding window chunking to `512` tokens and `50` overlap, strictly preferring sentence and paragraph boundaries to maintain semantic integrity.

### 6) UI lock & token enforcement
- `client/src/app/globals.css`: Removed default color tokens and enforced strict B&W grayscale tokens globally (via Tailwind v4 `@theme`).
- Handled pixel-perfect styling for Auth, Chat, and Resource Preview screens.

### 7) Attendance simplified MVP
- `server/src/routes/attendance.js`: Implemented Haversine-based GPS attendance validation.
- Validates student coordinates against session's 50m radius bounding box.
- Logs `device_id` (via `X-Device-Id` header) and hashes coordinates (`student_location_hash`) to provide primitive anti-spoofing in `attendance_records` table.

### 8) Tests & QA
- Integrated `jest` and `supertest` dependencies.
- Added comprehensive unit testing suite in `server/tests/`:
  - `ask-not-found.test.js`: Validates fallback to the exact NOT_FOUND phrase.
  - `threshold.test.js`: Validates standard numeric filtering logic.
  - `chunk-metadata.test.js`: Confirms chunking preserves headings and text boundaries.
  - `attendance.test.js`: Confirms geospatial math accuracy (Haversine formula bounds).
- `server/tests/e2e.test.js`: E2E mock pipeline ensuring that high-relevance chunks return a `[1]` citation and low-relevance chunks fallback correctly and log to audit.

### 9) Metrics & alerts
- `/api/ask` now emits console metrics logging `query.count`, `query.was_found_rate`, `avg_similarity`, `llm.calls`, and `token_usage` for real-time observability scraping.

## Commits
* `fix(rag): format context and enforce context-only responses`
* `feat(rag): raise similarity threshold & implement fast fallback`
* `chore(db): add chunk metadata columns and migration script`
* `feat(audit): enrich ai_audit_logs with precision similarity and metrics`
* `fix(ui): lock design system to strict B&W tokens`
* `feat(attendance): implement MVP GPS validation via Haversine`
* `test: add unit & robust e2e smoke tests`

## How to Test Locally
1. **Run Migrations**: Execute the migration script on your database instance: `psql -f server/src/db/migration_01.sql` (or via TablePlus/pgAdmin).
2. **Run Tests**: Change directory to `server` and run `npm run test` (or `npx jest`) to run the 5 unit and e2e test files.
3. **Smoke Test UI**: Launch the frontend and navigate to Auth, Chat, and Resources pages to verify grayscale compliance.
4. **Attendance**: In the UI, use Mock GPS settings in your browser dev tools to attempt attendance outside the 50m radius and observe the rejection.

## New Environment Variables Required
None explicitly required (uses existing database setup). Optional override:
- `SIMILARITY_THRESHOLD`: Defaults to 0.55 if omitted.

## UI Lock Acceptance Checklist (Polished Screens)
- [x] Auth screen (B&W tokens only)
- [x] Chat screen (Strict grayscale borders, text, backgrounds)
- [x] Resource preview screen
