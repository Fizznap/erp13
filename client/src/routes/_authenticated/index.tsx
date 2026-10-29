import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, CalendarCheck, FolderOpen, Award, ArrowRight } from "lucide-react";
import { MenuSheet } from "@/components/snippet/MenuSheet";
import { useMe } from "@/hooks/use-auth";
import { useAvatarUrl } from "@/lib/avatar";
import { FacultyHome } from "@/components/snippet/FacultyHome";
import { AppShell, Progress, SectionTitle, Spark } from "@/components/snippet/AppShell";
import { api, fetchSubjects, SUBJECTS_QUERY_KEY } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Snippet — Your college, with AI built in" },
      { name: "description", content: "Classes, attendance, resources and results in one place, with Ask Snippet AI woven through." },
      { property: "og:title", content: "Snippet — Your college, with AI built in" },
      { property: "og:description", content: "A modern college ERP with an embedded AI study assistant." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const quick = [
  { label: "Classroom", icon: BookOpen, tint: "bg-lavender", to: "/subjects" },
  { label: "Attendance", icon: CalendarCheck, tint: "bg-mint", to: "/attendance" },
  { label: "Resources", icon: FolderOpen, tint: "bg-sky", to: "/resources" },
  { label: "Results", icon: Award, tint: "bg-peach", to: "/results" },
];

function Home() {
  const { me } = useMe();
  const student = useAvatarUrl(me?.avatar);
  if (!me) {
    return (
      <AppShell>
        <p className="py-12 text-center text-sm text-muted-foreground">Loading your dashboard…</p>
      </AppShell>
    );
  }
  return (
    <AppShell>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <MenuSheet />
        <p className="truncate text-center text-sm text-muted-foreground">Good morning 👋</p>
        <Link to="/profile" aria-label="Profile" className="press block h-11 w-11 overflow-hidden rounded-full ring-2 ring-card">{student ? <img src={student} alt="" width={44} height={44} className="h-full w-full object-cover object-top" /> : <span className="grid h-full w-full place-items-center bg-muted text-sm font-semibold">{me?.name?.[0] ?? ""}</span>}</Link>
      </header>

      {me.isFaculty ? <FacultyHome name={me.name} /> : me.isAdmin ? <AdminHome name={me.name} /> : <StudentHome />}
    </AppShell>
  );
}

function StudentHome() {
  const subjects = useQuery({
    queryKey: SUBJECTS_QUERY_KEY,
    queryFn: fetchSubjects,
  });

  const attendance = useQuery({
    queryKey: ["my-history"],
    queryFn: () => api<{ records: { status: string }[] }>("/attendance/my/records"),
  });
  const records = attendance.data?.records ?? [];
  const present = records.filter((record) => record.status === "present").length;
  const attendanceRate = records.length ? (present / records.length) * 100 : null;

  return (
    <>
      <h1 className="rise mt-8 text-[28px] font-semibold leading-tight tracking-tight sm:text-4xl">
        What do you need<br />today?
      </h1>

      <Link to="/ask" className="rise press mt-6 block overflow-hidden rounded-[26px] bg-ai p-5 text-primary-foreground shadow-float">
        <div className="flex items-center gap-2 text-sm font-semibold"><Spark /> Ask Snippet</div>
        <p className="mt-2 max-w-[16rem] text-lg font-medium leading-snug">Ask anything about your course material</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="rounded-full bg-card/50 px-3 py-1 text-xs font-medium">
            {subjects.data?.length ? `${subjects.data.length} assigned subjects` : "Your assigned subjects"}
          </span>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-foreground text-background"><ArrowRight className="h-4 w-4" /></span>
        </div>
      </Link>

      <SectionTitle>Quick Access</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {quick.map((q) => (
          <Link key={q.label} to={q.to} className="surface press flex min-w-0 items-center gap-3 rounded-[20px] p-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${q.tint}`}><q.icon className="h-[18px] w-[18px]" /></span>
            <span className="truncate text-sm font-medium">{q.label}</span>
          </Link>
        ))}
      </div>

      <SectionTitle>Today's Schedule</SectionTitle>
      <div className="surface divide-y divide-border rounded-[24px]">
        <p className="p-4 text-sm text-muted-foreground">No schedule has been published yet.</p>
      </div>

      <SectionTitle action={<Link to="/attendance" className="text-xs font-medium text-primary-deep">Mark &amp; view</Link>}>Attendance</SectionTitle>
      <div className="surface rounded-[24px] p-5">
        <div className="flex items-end justify-between">
          <p className="text-4xl font-semibold tracking-tight">{attendanceRate == null ? "—" : attendanceRate.toFixed(1)}{attendanceRate != null && <span className="text-xl text-muted-foreground">%</span>}</p>
          <p className="text-xs text-muted-foreground">{records.length ? `${present} of ${records.length} sessions` : "No attendance records yet"}</p>
        </div>
        {attendanceRate != null && <div className="mt-4"><Progress value={attendanceRate} /></div>}
      </div>

      <SectionTitle>Feed</SectionTitle>
      <div className="space-y-3">
        <p className="surface rounded-[22px] p-4 text-sm text-muted-foreground">No updates yet.</p>
      </div>
    </>
  );
}

function AdminHome({ name }: { name: string }) {
  return (
    <>
      <h1 className="rise mt-8 text-[28px] font-semibold leading-tight tracking-tight">Welcome, {name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Manage the academic structure, users and subjects from the administrator console.</p>
      <Link to="/admin" className="press mt-6 flex items-center justify-between rounded-[24px] bg-ai p-5 text-sm font-semibold text-primary-foreground shadow-float">
        Open administrator console <ArrowRight className="h-4 w-4" />
      </Link>
    </>
  );
}
