import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Square, Users, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api, fetchSubjects, SUBJECTS_QUERY_KEY } from "@/lib/api";

type LabGroup = {
  id: string;
  branch_id: string;
  batch_id: string;
  division_id: string;
  name: string;
};
type RosterStudent = {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  status: "present" | "absent" | "needs_review";
  marked_at: string | null;
};

export const Route = createFileRoute("/_authenticated/faculty")({
  head: () => ({
    meta: [
      { title: "Faculty attendance — Snippet" },
      { property: "og:title", content: "Faculty attendance — Snippet" },
      {
        property: "og:description",
        content: "Open attendance sessions and manage your class sections.",
      },
      {
        name: "description",
        content: "Open an attendance session and show a fresh, time-limited code to your class.",
      },
    ],
  }),
  component: Faculty,
});

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Faculty() {
  const { me, loading } = useMe();
  if (loading)
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  return (
    <AppShell>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Link
          to="/attendance"
          aria-label="Back"
          className="glass press grid h-11 w-11 place-items-center rounded-full"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <p className="truncate text-center font-semibold">Faculty</p>
        <span className="h-11 w-11" />
      </header>
      {me?.isFaculty ? (
        <FacultyConsole />
      ) : (
        <p className="mt-10">You must be a faculty member to view this.</p>
      )}
    </AppShell>
  );
}

function FacultyConsole() {
  const qc = useQueryClient();
  const now = useNow();
  const [subjectId, setSubjectId] = useState("");
  const [sessionType, setSessionType] = useState<"lecture" | "lab">("lecture");
  const [labGroupId, setLabGroupId] = useState("");
  const [err, setErr] = useState("");

  const subjects = useQuery({
    queryKey: SUBJECTS_QUERY_KEY,
    queryFn: fetchSubjects,
  });
  const hierarchy = useQuery({
    queryKey: ["academic-hierarchy"],
    queryFn: () => api<{ labGroups: LabGroup[] }>("/academic/hierarchy"),
  });
  const selectedSubject = subjects.data?.find((subject) => subject.offering_id === subjectId);
  const availableLabGroups = (hierarchy.data?.labGroups ?? []).filter(
    (group) =>
      selectedSubject &&
      group.branch_id === selectedSubject.branch_id &&
      group.batch_id === selectedSubject.batch_id &&
      group.division_id === selectedSubject.division_id,
  );

  const [activeSession, setActiveSession] = useState<any>(null);
  const [savingStudentId, setSavingStudentId] = useState("");
  const [activeNonce, setActiveNonce] = useState<string>("");
  const [nonceExpires, setNonceExpires] = useState<string>("");

  const runStart = async () => {
    setErr("");
    try {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            try {
              const { session } = await api<{ session: any }>("/attendance/start", {
                method: "POST",
                body: {
                  subjectOfferingId: subjectId,
                  sessionType,
                  ...(sessionType === "lab" ? { academicLabGroupId: labGroupId } : {}),
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                  radiusMeters: 50,
                },
              });
              setActiveSession(session);
              setActiveNonce(session.active_nonce);
              setNonceExpires(session.nonce_expires);
              void qc.invalidateQueries({ queryKey: ["attendance-sessions", subjectId] });
            } catch (e: any) {
              setErr(e.message);
            }
          },
          () => {
            setErr("Location required to start session.");
          },
        );
      } else {
        setErr("Location not supported");
      }
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const runEnd = async () => {
    try {
      await api(`/attendance/${activeSession.id}/end`, { method: "POST" });
      setActiveSession({ ...activeSession, is_active: false });
      setActiveNonce("");
      void qc.invalidateQueries({ queryKey: ["attendance-sessions", subjectId] });
    } catch (e: any) {
      setErr(e.message);
    }
  };

  // Poll the complete division or lab-group roster, including students not yet marked present.
  const attendees = useQuery({
    queryKey: ["attendance-roster", activeSession?.id],
    enabled: !!activeSession,
    queryFn: async () => {
      const { students } = await api<{ students: RosterStudent[] }>(`/attendance/${activeSession.id}/roster`);
      return students;
    },
    refetchInterval: 5000,
  });

  const sessionHistory = useQuery({
    queryKey: ["attendance-sessions", subjectId],
    enabled: !!subjectId && !activeSession,
    queryFn: async () => {
      const { sessions } = await api<{ sessions: any[] }>(`/attendance/sessions?subjectOfferingId=${encodeURIComponent(subjectId)}`);
      return sessions;
    },
  });

  const updateStudentStatus = async (student: RosterStudent) => {
    const status = student.status === "present" ? "absent" : "present";
    setSavingStudentId(student.student_id);
    setErr("");
    try {
      await api(`/attendance/${activeSession.id}/roster/${student.student_id}`, {
        method: "PUT",
        body: { status, note: "Updated by faculty" },
      });
      await qc.invalidateQueries({ queryKey: ["attendance-roster", activeSession.id] });
    } catch (e: any) {
      setErr(e.message || "Could not update attendance");
    } finally {
      setSavingStudentId("");
    }
  };

  // Poll for nonce
  useEffect(() => {
    if (!activeSession?.is_active) return;
    const interval = setInterval(async () => {
      try {
        const { nonce, expiresAt } = await api<{ nonce: string; expiresAt: string }>(
          `/attendance/${activeSession.id}/nonce`,
        );
        setActiveNonce(nonce);
        setNonceExpires(expiresAt);
      } catch (e) {
        // Handle error silently during polling
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [activeSession?.id, activeSession?.is_active]);

  const left = nonceExpires
    ? Math.max(0, Math.floor((new Date(nonceExpires).getTime() - now) / 1000))
    : 0;

  return (
    <>
      {activeSession?.is_active ? (
        <section className="rise mt-6 overflow-hidden rounded-[26px] bg-id p-6 text-center text-id-foreground shadow-float">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">
            {sessionType === "lab" ? "Lab group" : "Division-wide lecture"}
          </p>
          <p className="mt-6 font-mono text-[44px] font-bold leading-none tracking-[0.25em] sm:text-6xl">
            {activeNonce}
          </p>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-sm opacity-90">
            <Clock className="h-4 w-4" /> Code changes in {Math.floor(left / 60)}:
            {String(left % 60).padStart(2, "0")}
          </p>
          <div className="mx-auto mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-id-foreground/20">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, (left / 30) * 100)}%` }}
            />
          </div>
          <div className="mt-6 grid grid-cols-1 gap-3">
            <button
              onClick={runEnd}
              className="press flex items-center justify-center gap-2 rounded-2xl bg-id-foreground/15 py-3 text-sm font-semibold"
            >
              <Square className="h-4 w-4" /> End session
            </button>
          </div>
        </section>
      ) : activeSession ? (
        <section className="surface rise mt-6 flex items-center justify-between gap-4 rounded-[26px] p-5">
          <div>
            <p className="text-sm font-semibold">Session roster</p>
            <p className="mt-1 text-xs text-muted-foreground">{new Date(activeSession.started_at).toLocaleString("en-IN")} · Attendance can still be corrected.</p>
          </div>
          <button onClick={() => setActiveSession(null)} className="press rounded-full bg-muted px-3 py-2 text-xs font-semibold">Choose another</button>
        </section>
      ) : (
        <section className="surface rise mt-6 rounded-[26px] p-5">
          <h1 className="text-xl font-semibold">Open a session</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Students enter the code on their Attendance tab before it expires.
          </p>
          <label className="mt-4 block text-sm font-medium">Subject Class</label>
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-sm outline-hidden"
          >
            <option value="">
              {subjects.data?.length ? "Choose a class" : "No classes assigned"}
            </option>
            {subjects.data?.map((s) => (
              <option key={s.offering_id || s.id} value={s.offering_id ?? ""}>
                {s.code} · {s.branch_name} - Div {s.division_name}
              </option>
            ))}
          </select>
          <label className="mt-4 block text-sm font-medium">Attendance scope</label>
          <select
            value={sessionType}
            onChange={(e) => {
              setSessionType(e.target.value as "lecture" | "lab");
              setLabGroupId("");
            }}
            className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-sm outline-hidden"
          >
            <option value="lecture">Lecture · entire division</option>
            <option value="lab">Lab · selected group</option>
          </select>
          {sessionType === "lab" && (
            <>
              <label className="mt-4 block text-sm font-medium">Lab group</label>
              <select
                value={labGroupId}
                onChange={(e) => setLabGroupId(e.target.value)}
                disabled={!selectedSubject || availableLabGroups.length === 0}
                className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-sm outline-hidden disabled:opacity-50"
              >
                <option value="">
                  {availableLabGroups.length
                    ? "Choose lab group"
                    : "No lab groups configured for this division"}
                </option>
                {availableLabGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {selectedSubject?.branch_name} · Div {selectedSubject?.division_name} · {group.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <button
            disabled={!subjectId || (sessionType === "lab" && !labGroupId)}
            onClick={runStart}
            className="press mt-5 w-full rounded-2xl bg-ai py-3.5 text-sm font-semibold text-primary-foreground shadow-float disabled:opacity-40"
          >
            Open session & show code
          </button>
        </section>
      )}
      {err && <p className="mt-3 text-xs text-destructive">{err}</p>}

      {!activeSession && subjectId && (
        <>
          <SectionTitle>Recent sessions</SectionTitle>
          <div className="surface divide-y divide-border rounded-[24px]">
            {(sessionHistory.data ?? []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No sessions for this class yet.</p>}
            {sessionHistory.data?.map((session: any) => (
              <button key={session.id} onClick={() => setActiveSession(session)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                <span>
                  <span className="block text-sm font-medium">{new Date(session.started_at).toLocaleString("en-IN")}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{session.is_active ? "Live" : "Ended"} · {session.present_count} present</span>
                </span>
                <span className="text-xs font-semibold text-primary-deep">View roster</span>
              </button>
            ))}
          </div>
        </>
      )}

      {activeSession && (
        <>
          <SectionTitle
            action={
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                {(attendees.data ?? []).filter((student) => student.status === "present").length} present · {(attendees.data ?? []).filter((student) => student.status !== "present").length} absent
              </span>
            }
          >
            Class roster
          </SectionTitle>
          <div className="surface divide-y divide-border rounded-[24px]">
            {(attendees.data ?? []).length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No students are assigned to this class yet.</p>
            )}
            {attendees.data?.map((student) => (
              <div key={student.student_id} className="flex items-center justify-between gap-3 p-4 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{student.full_name}</span>
                  {student.roll_number && <span className="mt-0.5 block text-xs text-muted-foreground">{student.roll_number}</span>}
                  {student.marked_at && <span className="mt-0.5 block text-xs text-muted-foreground">{new Date(student.marked_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={`text-xs font-semibold ${student.status === "present" ? "text-primary-deep" : student.status === "needs_review" ? "text-destructive" : "text-muted-foreground"}`}>
                    {student.status === "needs_review" ? "Needs review" : student.status}
                  </span>
                  <button disabled={savingStudentId === student.student_id} onClick={() => void updateStudentStatus(student)} className="press rounded-full border border-border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50">
                    {savingStudentId === student.student_id ? "Saving…" : student.status === "present" ? "Mark absent" : "Mark present"}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
