# Implementation Plan & Roadmap

## Milestones

### Milestone 1: Core Foundation & UI (Weeks 1-2)
- Scaffold Next.js App Router & Express backend.
- Set up Postgres + `pgvector` schemas (`schema.sql`).
- Implement mobile-first B&W UI tokens and Bottom Nav.

### Milestone 2: RAG Pipeline (Weeks 3-4)
- Deploy Bull/Redis queue and Worker logic.
- Implement PDF extraction and semantic chunking.
- Implement `/ask` endpoint with `< 0.55` cosine threshold fast-fail.
- *Strict Rule*: Output exact `"Not in provided material."` string.

### Milestone 3: ERP Integration & Attendance (Weeks 5-6)
- Build `/webhooks/erp/sync/subjects` and enrollments.
- Implement server-side Haversine distance attendance validation (<= 50m radius).
- Build Admin Override routes.

### Milestone 4: QA & Phase 2 Preparations (Week 7)
- E2E testing for RAG hallucination and GPS limits.
- Stub out FaceMatchAdapter interface for Phase 2.

---

## OpenEduCat Integration Mapping (Git Paths)

To reuse existing OpenEduCat models and concepts, map the following exact Git paths from `openeducat/openeducat_erp`:

1. **Subjects / Classroom**
   - *OpenEduCat Path*: `openeducat_classroom/models/classroom.py`
   - *Snippet Mapping*: Maps to `subjects` table. We sync `erp_reference_id`, `name`, and `code`.
2. **Enrollments**
   - *OpenEduCat Path*: `openeducat_admission/models/admission.py` and `openeducat_core/models/student.py`
   - *Snippet Mapping*: Maps to `subject_enrollments`.
3. **Attendance**
   - *OpenEduCat Path*: `openeducat_attendance/models/attendance_line.py`
   - *Snippet Mapping*: Maps to `attendance_records` (plus Snippet's custom GPS lat/long fields).
4. **Timetable**
   - *OpenEduCat Path*: `openeducat_timetable/models/timetable.py`
   - *Snippet Mapping*: Used to auto-suggest subject scheduling for faculty starting a session.

**Sample Webhook Script**
```bash
# Simulating a webhook sync from OpenEduCat
curl -X POST https://api.snippet.app/v1/webhooks/erp/sync/subjects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ERP_SECRET>" \
  -d '[{"erp_subject_id": "CLASS101", "name": "Intro to CS", "code": "CS101"}]'
```
