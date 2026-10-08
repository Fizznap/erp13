<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Snippet UI: shared AppShell (bottom glass nav + floating Ask Snippet) wraps every page; design tokens/utilities (glass, surface, bg-ai, orb) live in src/styles.css — keeps glass selective and consistent.
- Attendance: codes stay server-side; students only mark/read via security-definer RPCs (live_sessions, mark_attendance, my_attendance_history) so codes never leak. Faculty role granted only when an admin approves a faculty_requests row via review_faculty_request RPC.
- Attendance AI: server fn askAttendanceAI (Responses API, streamed and consumed server-side) grounds answers in the caller's own history.
- Sections: faculty-owned class_sections + section_members; sessions opened per section (open_section_session) and live/mark/history RPCs only include enrolled students — keeps absences scoped to the right class. Legacy sessions without a section still apply to everyone.
- Attendance plan: server fn generateAttendancePlan saves schedule/goal to attendance_plans, then generates and stores the AI plan grounded in the caller's history.
- Sign-in help: diagnoseSignInProblem is intentionally public (students who can't sign in need it); it reads no account data and caps input length.
- Auth: every app page lives under _authenticated so sign-in is asked once at app start; only /auth and /verify/$studentNo are public.
- ID card: student identity columns on profiles are not user-updatable (column-level grant on full_name only); QR links to public /verify/$studentNo which uses verify_student RPC exposing only name, ID, college, course, batch, photo.
- Profiles: users edit their own details via column-level UPDATE grants; student_no stays admin-only. Photos live in the private avatars bucket (own-folder writes), stored as "sb:<path>" and resolved to signed URLs by useAvatarUrl.
- Faculty UX: Home switches to FacultyHome for faculty role. Manual attendance fallback = manual_attendance_requests + request/review RPCs (faculty approves → attendance_records insert). Sections carry branch/division.
- Resources: resources table + private resources bucket; faculty upload into their own folder, all signed-in users read via signed URLs.
- Academic structure: branches → batches → divisions; a student's profiles.division_id (set once via complete_registration, changed only by admin RPC) auto-enrolls them into every class_section of that division via triggers — so attendance and resource access follow the student's class without manual rosters.
- Resource access: resources must carry a section_id; RLS (is_section_member) limits reads to that class, and storage reads require a readable resources row — any future AI retrieval must query through these policies before searching.
- Face ID: only enrollment consent/status is stored (face_enrollments); no images are saved. Real matching plugs in later behind request_face_enrollment.
