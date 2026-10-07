# Snippet ERP: Campus App PRD

## Roles
- **Student**: Consumes announcements, views enrolled subjects, accesses RAG-based AI chat for PDFs, marks GPS attendance.
- **Faculty**: Creates announcements, uploads PDFs/slides to subjects, triggers GPS attendance sessions.
- **Admin**: Syncs OpenEduCat modules (Subjects, Users, Enrollments), overrides attendance.

## Core Flows
1. **RAG Q&A**: Faculty uploads PDF → Async Worker chunks/embeds → Student asks question → Server retrieves chunks → Evaluates threshold (< 0.55 fast-fails) → LLM generates numbered citations → UI displays.
2. **Attendance**: Faculty taps "Start Session" (captures GPS origin + sets 50m radius + generates 30s nonce) → Student taps "Mark Present" (sends device GPS, device_id header, nonce) → Server calculates Haversine distance → If <= 50m, marks present; else rejects.
3. **ERP Sync**: Webhooks import OpenEduCat classroom and enrollment concepts into Snippet.

## Acceptance Criteria
- **RAG / Anti-Hallucination**: Must never hallucinate. Unrelated questions immediately return EXACTLY `"Not in provided material."` without hitting LLM if average top-K cosine similarity < 0.55.
- **Attendance**: GPS spoofs or distances > 50m strictly rejected server-side. Admin override available.
- **UI**: Mobile-first ERP style (Feed, Classroom, Reminders, Help) with strictly B&W/Grayscale tokens. All endpoints return sources arrays with explicit chunk metadata for UI citations.
