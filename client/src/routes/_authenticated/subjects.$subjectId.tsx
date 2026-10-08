import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, MoreHorizontal, FolderOpen, ClipboardList, ArrowRight } from "lucide-react";
import { AppShell, Progress, SectionTitle, Spark } from "@/components/snippet/AppShell";

export const Route = createFileRoute("/_authenticated/subjects/$subjectId")({
  head: () => ({
    meta: [
      { title: "DBMS — Snippet" },
      { name: "description", content: "Progress, coursework, assessments and AI study help for Database Management Systems." },
      { property: "og:title", content: "DBMS — Snippet" },
      { property: "og:description", content: "Your subject hub: progress, resources, assignments and results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Subject,
});

function Subject() {
  const router = useRouter();
  return (
    <AppShell>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <button onClick={() => router.history.back()} aria-label="Back" className="glass press grid h-11 w-11 place-items-center rounded-full"><ArrowLeft className="h-5 w-5" /></button>
        <p className="truncate text-center font-semibold">DBMS</p>
        <button aria-label="More" className="glass press grid h-11 w-11 place-items-center rounded-full"><MoreHorizontal className="h-5 w-5" /></button>
      </header>

      <h1 className="rise mt-8 text-[26px] font-semibold leading-tight tracking-tight">Database Management Systems</h1>
      <p className="mt-1 text-sm text-muted-foreground">CS301 • Semester 5 • Prof. Mehta</p>

      <div className="surface mt-6 rounded-[24px] p-5">
        <div className="flex items-center justify-between text-sm"><span className="font-medium">Your progress</span><span className="font-semibold">72%</span></div>
        <div className="mt-3"><Progress value={72} /></div>
      </div>

      <SectionTitle>Coursework</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Link to="/resources" className="surface press rounded-[22px] p-4">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-sky"><FolderOpen className="h-[18px] w-[18px]" /></span>
          <p className="mt-4 text-sm text-muted-foreground">Resources</p>
          <p className="text-2xl font-semibold">24</p>
        </Link>
        <div className="surface rounded-[22px] p-4">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-peach"><ClipboardList className="h-[18px] w-[18px]" /></span>
          <p className="mt-4 text-sm text-muted-foreground">Assignments</p>
          <p className="text-2xl font-semibold">3</p>
        </div>
      </div>

      <SectionTitle>Assessment</SectionTitle>
      <div className="surface divide-y divide-border rounded-[24px]">
        {[["Internal Test 1", 82], ["Quiz 1", 90], ["Assignment 1", 76]].map(([n, v]) => (
          <div key={n} className="flex items-center justify-between p-4 text-sm">
            <span>{n}</span><span className="font-semibold">{v}%</span>
          </div>
        ))}
      </div>

      <SectionTitle>AI Study</SectionTitle>
      <Link to="/ask" className="press flex items-center gap-4 rounded-[24px] border border-border bg-accent p-5">
        <span className="orb h-11 w-11 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-semibold"><Spark /> Ask Snippet</p>
          <p className="truncate text-sm text-accent-foreground">Ask about DBMS material</p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0" />
      </Link>
    </AppShell>
  );
}
