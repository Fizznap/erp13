import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, MoreHorizontal, FolderOpen, ClipboardList, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, Progress, SectionTitle, Spark } from "@/components/snippet/AppShell";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/subjects/$subjectId")({
  head: () => ({
    meta: [
      { title: "Subject — Snippet" },
      { name: "description", content: "Resources and study help for your subject." },
      { property: "og:title", content: "Subject — Snippet" },
      { property: "og:description", content: "Your subject resources and study help." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Subject,
});

function Subject() {
  const router = useRouter();
  const { subjectId } = Route.useParams();
  const { me } = useMe();
  const subject = useQuery({
    queryKey: ["subject", subjectId],
    queryFn: () => api<{ subject: { name: string; code: string; description?: string | null; resource_count?: number | string | null } }>(`/subjects/${subjectId}`),
  });
  const attendance = useQuery({
    queryKey: ["my-history", subjectId],
    queryFn: () => api<{ records: { status: string }[] }>(`/attendance/my/records?subjectId=${encodeURIComponent(subjectId)}`),
    enabled: me?.user?.role === "student",
  });
  const name = subject.data?.subject.name || "Subject";
  const code = subject.data?.subject.code || subjectId;
  const records = attendance.data?.records ?? [];
  const present = records.filter((record) => record.status === "present").length;
  const attendanceRate = records.length ? (present / records.length) * 100 : null;
  const resourceCount = Number(subject.data?.subject.resource_count || 0);
  return (
    <AppShell>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <button onClick={() => router.history.back()} aria-label="Back" className="glass press grid h-11 w-11 place-items-center rounded-full"><ArrowLeft className="h-5 w-5" /></button>
        <p className="truncate text-center font-semibold">{code}</p>
        <button aria-label="More" className="glass press grid h-11 w-11 place-items-center rounded-full"><MoreHorizontal className="h-5 w-5" /></button>
      </header>

      <h1 className="rise mt-8 text-[26px] font-semibold leading-tight tracking-tight">{name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{code}{subject.isLoading ? " • Loading class details…" : ""}</p>

      {attendanceRate != null && (
        <div className="surface mt-6 rounded-[24px] p-5">
          <div className="flex items-center justify-between text-sm"><span className="font-medium">Attendance</span><span className="font-semibold">{attendanceRate.toFixed(1)}%</span></div>
          <div className="mt-3"><Progress value={attendanceRate} /></div>
          <p className="mt-2 text-xs text-muted-foreground">{present} of {records.length} sessions</p>
        </div>
      )}

      <SectionTitle>Coursework</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Link to="/resources" className="surface press rounded-[22px] p-4">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-sky"><FolderOpen className="h-[18px] w-[18px]" /></span>
          <p className="mt-4 text-sm text-muted-foreground">Resources</p>
          <p className="text-2xl font-semibold">{resourceCount}</p>
        </Link>
        <div className="surface rounded-[22px] p-4">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-peach"><ClipboardList className="h-[18px] w-[18px]" /></span>
          <p className="mt-4 text-sm text-muted-foreground">Assignments</p>
          <p className="mt-1 text-sm text-muted-foreground">No records yet</p>
        </div>
      </div>

      <SectionTitle>Assessment</SectionTitle>
      <div className="surface divide-y divide-border rounded-[24px]">
        <p className="p-4 text-sm text-muted-foreground">No assessment results have been published.</p>
      </div>

      <SectionTitle>AI Study</SectionTitle>
      <Link to="/ask" className="press flex items-center gap-4 rounded-[24px] border border-border bg-accent p-5">
        <span className="orb h-11 w-11 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-semibold"><Spark /> Ask Snippet</p>
           <p className="truncate text-sm text-accent-foreground">Ask about {name} material</p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0" />
      </Link>
    </AppShell>
  );
}
