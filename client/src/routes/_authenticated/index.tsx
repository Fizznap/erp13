import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, CalendarCheck, FolderOpen, Award, ArrowRight, MapPin } from "lucide-react";
import { MenuSheet } from "@/components/snippet/MenuSheet";
import { useMe } from "@/hooks/use-auth";
import { useAvatarUrl } from "@/lib/avatar";
import { FacultyHome } from "@/components/snippet/FacultyHome";
import { AppShell, Progress, SectionTitle, Spark } from "@/components/snippet/AppShell";

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
  { label: "Classroom", icon: BookOpen, tint: "bg-lavender", to: "/subjects/$subjectId" },
  { label: "Attendance", icon: CalendarCheck, tint: "bg-mint", to: "/attendance" },
  { label: "Resources", icon: FolderOpen, tint: "bg-sky", to: "/resources" },
  { label: "Results", icon: Award, tint: "bg-peach", to: "/subjects/$subjectId" },
];

const schedule = [
  { time: "10:00", name: "DBMS", room: "Room 204", now: true },
  { time: "11:30", name: "Operating Systems", room: "Lab 3" },
  { time: "14:00", name: "Computer Networks", room: "Room 110" },
];

const feed = [
  { who: "Prof. Mehta", what: "Uploaded Unit 2 slides for DBMS", when: "20m", ai: true },
  { who: "Exam Cell", what: "Internal Test 2 timetable published", when: "2h" },
];

function Home() {
  const { me } = useMe();
  const student = useAvatarUrl(me?.avatar);
  return (
    <AppShell>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <MenuSheet />
        <p className="truncate text-center text-sm text-muted-foreground">Good morning 👋</p>
        <Link to="/profile" aria-label="Profile" className="press block h-11 w-11 overflow-hidden rounded-full ring-2 ring-card">{student ? <img src={student} alt="" width={44} height={44} className="h-full w-full object-cover object-top" /> : <span className="grid h-full w-full place-items-center bg-muted text-sm font-semibold">{me?.name?.[0] ?? ""}</span>}</Link>
      </header>

      {me?.isFaculty ? <FacultyHome name={me.name} /> : <StudentHome />}
    </AppShell>
  );
}

function StudentHome() {
  return (
    <>
      <h1 className="rise mt-8 text-[28px] font-semibold leading-tight tracking-tight sm:text-4xl">
        What do you need<br />today?
      </h1>

      <Link to="/ask" className="rise press mt-6 block overflow-hidden rounded-[26px] bg-ai p-5 text-primary-foreground shadow-float">
        <div className="flex items-center gap-2 text-sm font-semibold"><Spark /> Ask Snippet</div>
        <p className="mt-2 max-w-[16rem] text-lg font-medium leading-snug">Ask anything about your course material</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="rounded-full bg-card/50 px-3 py-1 text-xs font-medium">Based on 5 subjects</span>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-foreground text-background"><ArrowRight className="h-4 w-4" /></span>
        </div>
      </Link>

      <SectionTitle>Quick Access</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {quick.map((q) => (
          <Link key={q.label} to={q.to as "/subjects/$subjectId"} params={{ subjectId: "dbms" }} className="surface press flex min-w-0 items-center gap-3 rounded-[20px] p-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${q.tint}`}><q.icon className="h-[18px] w-[18px]" /></span>
            <span className="truncate text-sm font-medium">{q.label}</span>
          </Link>
        ))}
      </div>

      <SectionTitle action={<span className="text-xs text-muted-foreground">Thu, 8 Oct</span>}>Today's Schedule</SectionTitle>
      <div className="surface divide-y divide-border rounded-[24px]">
        {schedule.map((s) => (
          <Link key={s.time} to="/subjects/$subjectId" params={{ subjectId: "dbms" }} className="flex items-center gap-4 p-4">
            <span className={`w-12 shrink-0 text-sm font-semibold ${s.now ? "text-primary-deep" : "text-muted-foreground"}`}>{s.time}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.name}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{s.room}</p>
            </div>
            {s.now && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">Now</span>}
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>

      <SectionTitle action={<Link to="/attendance" className="text-xs font-medium text-primary-deep">Mark &amp; view</Link>}>Attendance</SectionTitle>
      <div className="surface rounded-[24px] p-5">
        <div className="flex items-end justify-between">
          <p className="text-4xl font-semibold tracking-tight">87.4<span className="text-xl text-muted-foreground">%</span></p>
          <p className="text-xs text-muted-foreground">Required 75%</p>
        </div>
        <div className="mt-4"><Progress value={87.4} /></div>
        <p className="mt-3 text-xs text-muted-foreground">You can skip 4 more classes and stay safe.</p>
      </div>

      <SectionTitle>Feed</SectionTitle>
      <div className="space-y-3">
        {feed.map((f) => (
          <div key={f.what} className="surface rounded-[22px] p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground"><span className="font-medium text-foreground">{f.who}</span>{f.when}</div>
            <p className="mt-1 text-sm">{f.what}</p>
            {f.ai && <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground"><Spark /> AI summary available</p>}
          </div>
        ))}
      </div>
    </>
  );
}
