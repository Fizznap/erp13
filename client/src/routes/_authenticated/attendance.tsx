import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, CheckCircle2, Clock, Presentation } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { SignInHelp } from "@/components/snippet/SignInHelp";
import { ManualRequest } from "@/components/snippet/ManualRequest";
import { AttendancePlan } from "@/components/snippet/AttendancePlan";
import { api } from "@/lib/api";
import { summarizeAttendanceHistory, uniqueAttendanceHistory } from "@/lib/attendance";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — Snippet" },
      { name: "description", content: "Mark attendance with your class code, review your history and ask AI about your trends." },
      { property: "og:title", content: "Attendance — Snippet" },
      { property: "og:description", content: "Mark attendance with a code and see your stats." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Attendance,
});

function useCountdown(to?: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!to) return "";
  const s = Math.max(0, Math.floor((new Date(to).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function Ring({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 80 80" className="h-20 w-20 shrink-0 -rotate-90">
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-muted" />
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" strokeLinecap="round" className="stroke-primary transition-all duration-700" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
    </svg>
  );
}

function Attendance() {
  const qc = useQueryClient();
  const { me } = useMe();
  
  // To get a live session for a student we use the subjects endpoint and assume they pick a session, 
  // or we need a new route. For now, let's just allow marking attendance via code.
  // We'll mock the live session state for now if we can't find it easily.
  const live = useQuery({
    queryKey: ["live-sessions"],
    queryFn: async () => {
      // The Express API doesn't have a specific GET /api/attendance/live route for students that returns a single live session globally.
      // In Snippet, students enter the code which acts as a session identifier.
      // So we will just return an empty array and rely on manual code entry.
      return [];
    },
  });

  const history = useQuery({
    queryKey: ["my-history"],
    queryFn: async () => {
      const data = await api<{ records: any[] }>("/attendance/my/records");
      return data.records ?? [];
    },
  });
  const records = useMemo(() => uniqueAttendanceHistory(history.data ?? []), [history.data]);

  const session = (live.data?.[0] as any);
  const countdown = useCountdown((session as any)?.expires_at);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    
    // We need latitude and longitude to submit
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
            const res = await api<{ status: string }>('/attendance/mark', {
              method: 'POST',
              body: { 
                nonce: code, 
                latitude: pos.coords.latitude, 
                longitude: pos.coords.longitude 
              }
            });
          setDone("Marked present");
          setCode("");
          qc.invalidateQueries({ queryKey: ["my-history"] });
        } catch (error: any) {
          setErr(error.message);
        } finally {
          setBusy(false);
        }
      }, (error) => {
        setErr("Location access is required to mark attendance.");
        setBusy(false);
      });
    } else {
      setErr("Geolocation not supported on this device.");
      setBusy(false);
    }
  };

  const stats = useMemo(() => summarizeAttendanceHistory(records), [records]);

  const marked = session?.already_marked || done;

  return (
    <AppShell>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="rise text-[28px] font-semibold tracking-tight">Attendance</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">Signed in as {me?.name ?? "…"}</p>
        </div>
        {me?.isFaculty && (
          <Link to="/faculty" className="press glass flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold">
            <Presentation className="h-4 w-4" /> Faculty
          </Link>
        )}
      </div>

      <section className="rise mt-6 overflow-hidden rounded-[26px] border border-border bg-card shadow-float">
        {session ? (
          <div className="bg-ai px-5 py-4 text-primary-foreground">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"><Radio className="h-4 w-4 animate-pulse" /> Live session open</p>
            <p className="mt-1 text-lg font-semibold">{session.subject_name}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs opacity-80">
              <span>{session.faculty_name}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Closes in {countdown}</span>
            </p>
          </div>
        ) : (
          <div className="bg-muted px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Submit Attendance</p>
            <p className="mt-1 text-sm text-muted-foreground">Enter the 6-character code shown by your faculty.</p>
          </div>
        )}
        {marked ? (
          <div className="flex flex-col items-center px-5 py-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-primary-deep" />
            <p className="mt-3 text-lg font-semibold">You're marked present</p>
            <p className="text-sm text-muted-foreground">{done ?? session?.subject_name}</p>
            {done && <button onClick={() => setDone(null)} className="mt-3 text-xs font-medium text-muted-foreground underline">Enter another code</button>}
          </div>
        ) : (
          <form onSubmit={submit} className="p-5">
            <label htmlFor="code" className="text-sm font-medium">Enter the code shown by your faculty</label>
            <input id="code" value={code} autoComplete="off"
              onChange={(e) => { setCode(e.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase()); setErr(""); }}
              placeholder="••••••"
              className={`mt-3 w-full rounded-2xl border bg-muted px-4 py-4 text-center font-mono text-2xl tracking-[0.5em] outline-hidden transition focus:border-primary focus:bg-card ${err ? "border-destructive" : "border-transparent"}`} />
            {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
            
            {/* Needs Subject Selection if backend requires it. For now, assuming code uniquely identifies or subject selection comes later. */}
            
            <button disabled={code.length !== 6 || busy} className="press mt-4 w-full rounded-2xl bg-foreground py-3.5 text-sm font-semibold text-background disabled:opacity-40">
              {busy ? "Marking…" : "Mark attendance"}
            </button>
          </form>
        )}
        {session && !marked && <ManualRequest sessionId={session.id} />}
      </section>

      <AttendancePlan />
      <SignInHelp page="attendance" />

      <SectionTitle>Overview</SectionTitle>
      <div className="surface flex items-center justify-between gap-4 rounded-[24px] p-5">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Overall attendance</p>
          <p className="text-4xl font-semibold tracking-tight">{stats.total ? stats.percentage.toFixed(1) : "—"}<span className="text-xl text-muted-foreground">%</span></p>
          <p className="text-xs text-muted-foreground">{stats.attended} of {stats.total} sessions</p>
        </div>
        <Ring value={stats.percentage} />
      </div>

      <SectionTitle>By subject</SectionTitle>
      {stats.list.length === 0 && <p className="surface rounded-[22px] p-4 text-sm text-muted-foreground">No sessions yet. Your subjects appear here after your first class.</p>}
      <div className="space-y-3">
        {stats.list.map((s) => {
          const p = s.percentage; const low = p < 75;
          return (
            <div key={s.id} className="surface rounded-[22px] p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-medium leading-snug">{s.name}</p>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${low ? "bg-peach text-destructive" : "bg-accent text-accent-foreground"}`}>{p.toFixed(1)}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${low ? "bg-destructive" : "bg-ai"}`} style={{ width: `${p}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{s.attended} of {s.total} sessions{low && " · below 75%"}</p>
            </div>
          );
        })}
      </div>

      <SectionTitle>History</SectionTitle>
      <div className="surface divide-y divide-border rounded-[24px]">
        {records.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing here yet.</p>}
        {records.slice(0, 50).map((h) => (
          <div key={h.session_id ?? h.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{h.subject_name}</p>
              <p className="text-xs text-muted-foreground">{new Date(h.session_date).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${h.status === 'present' ? "bg-accent text-accent-foreground" : "bg-peach text-destructive"}`}>{h.status === 'present' ? "present" : "absent"}</span>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
