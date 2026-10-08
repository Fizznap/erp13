import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Square, Users, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/faculty")({
  head: () => ({
    meta: [
      { title: "Faculty attendance — Snippet" },
      { name: "description", content: "Open an attendance session and show a fresh, time-limited code to your class." },
    ],
  }),
  component: Faculty,
});

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return now;
}

function Faculty() {
  const { me, loading } = useMe();
  if (loading) return <AppShell><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  return (
    <AppShell>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Link to="/attendance" aria-label="Back" className="glass press grid h-11 w-11 place-items-center rounded-full"><ArrowLeft className="h-5 w-5" /></Link>
        <p className="truncate text-center font-semibold">Faculty</p>
        <span className="h-11 w-11" />
      </header>
      {me?.isFaculty ? <FacultyConsole /> : <p className="mt-10">You must be a faculty member to view this.</p>}
    </AppShell>
  );
}

function FacultyConsole() {
  const qc = useQueryClient();
  const now = useNow();
  const [subjectId, setSubjectId] = useState("");
  const [err, setErr] = useState("");

  const subjects = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => { 
      const { subjects } = await api<{ subjects: any[] }>("/subjects"); 
      return subjects; 
    },
  });

  const [activeSession, setActiveSession] = useState<any>(null);
  const [activeNonce, setActiveNonce] = useState<string>("");
  const [nonceExpires, setNonceExpires] = useState<string>("");

  const runStart = async () => {
    setErr("");
    try {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
          try {
            const { session } = await api<{ session: any }>('/attendance/start', {
              method: 'POST',
              body: {
                subjectOfferingId: subjectId,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                radiusMeters: 50
              }
            });
            setActiveSession(session);
            setActiveNonce(session.active_nonce);
            setNonceExpires(session.nonce_expires);
          } catch (e: any) {
            setErr(e.message);
          }
        }, () => {
          setErr("Location required to start session.");
        });
      } else {
        setErr("Location not supported");
      }
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const runEnd = async () => {
    try {
      await api(`/attendance/${activeSession.id}/end`, { method: 'POST' });
      setActiveSession(null);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  // Poll for attendees
  const attendees = useQuery({
    queryKey: ["attendees", activeSession?.id],
    enabled: !!activeSession,
    queryFn: async () => {
      const { records } = await api<{ records: any[] }>(`/attendance/${activeSession.id}/records`);
      return records;
    },
    refetchInterval: 5000,
  });

  // Poll for nonce
  useEffect(() => {
    if (!activeSession) return;
    const interval = setInterval(async () => {
      try {
        const { nonce, expiresAt } = await api<{ nonce: string, expiresAt: string }>(`/attendance/${activeSession.id}/nonce`);
        setActiveNonce(nonce);
        setNonceExpires(expiresAt);
      } catch (e) {
        // Handle error silently during polling
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [activeSession]);

  const left = nonceExpires ? Math.max(0, Math.floor((new Date(nonceExpires).getTime() - now) / 1000)) : 0;

  return (
    <>
      {activeSession ? (
        <section className="rise mt-6 overflow-hidden rounded-[26px] bg-id p-6 text-center text-id-foreground shadow-float">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Subject {activeSession.subject_id}</p>
          <p className="mt-6 font-mono text-[44px] font-bold leading-none tracking-[0.25em] sm:text-6xl">{activeNonce}</p>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-sm opacity-90"><Clock className="h-4 w-4" /> Code changes in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
          <div className="mx-auto mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-id-foreground/20">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, (left / 30) * 100)}%` }} />
          </div>
          <div className="mt-6 grid grid-cols-1 gap-3">
            <button onClick={runEnd} className="press flex items-center justify-center gap-2 rounded-2xl bg-id-foreground/15 py-3 text-sm font-semibold"><Square className="h-4 w-4" /> End session</button>
          </div>
        </section>
      ) : (
        <section className="surface rise mt-6 rounded-[26px] p-5">
          <h1 className="text-xl font-semibold">Open a session</h1>
          <p className="mt-1 text-sm text-muted-foreground">Students enter the code on their Attendance tab before it expires.</p>
          <label className="mt-4 block text-sm font-medium">Subject Class</label>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="mt-2 w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-sm outline-hidden">
            <option value="">{subjects.data?.length ? "Choose a class" : "No classes assigned"}</option>
            {subjects.data?.map((s) => (
              <option key={s.offering_id} value={s.offering_id}>
                {s.code} · {s.branch_name} - Div {s.division_name}
              </option>
            ))}
          </select>
          <button disabled={!subjectId} onClick={runStart} className="press mt-5 w-full rounded-2xl bg-ai py-3.5 text-sm font-semibold text-primary-foreground shadow-float disabled:opacity-40">Open session & show code</button>
        </section>
      )}
      {err && <p className="mt-3 text-xs text-destructive">{err}</p>}

      {activeSession && (
        <>
          <SectionTitle action={<span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{attendees.data?.length ?? 0}</span>}>Marked present</SectionTitle>
          <div className="surface divide-y divide-border rounded-[24px]">
            {(attendees.data ?? []).length === 0 && <p className="p-4 text-sm text-muted-foreground">Waiting for students…</p>}
            {attendees.data?.map((a, i) => (
              <div key={i} className="flex items-center justify-between p-4 text-sm">
                <span className="truncate font-medium">{a.full_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{new Date(a.marked_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
