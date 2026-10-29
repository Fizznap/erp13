import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Award, BookOpen, AlertCircle, Sparkles } from "lucide-react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/results")({
  head: () => ({
    meta: [
      { title: "My Results — Snippet" },
      { property: "og:title", content: "My Results — Snippet" },
      {
        name: "description",
        content: "View your verified academic grades, marks, and semester performance.",
      },
    ],
  }),
  component: StudentResultsPage,
});

type AcademicResult = {
  id: string;
  studentId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  internalMarks: number | null;
  externalMarks: number | null;
  totalMarks: number | null;
  grade: string | null;
  gradePoints: number;
  credits: number;
  status: "published" | "draft" | "withheld";
  examType: string;
  academicYear: number;
  remarks?: string;
  isSynthetic: boolean;
};

type ResultsPayload = {
  results: AcademicResult[];
  summary: {
    totalCredits: number;
    cgpa: string;
  };
};

function StudentResultsPage() {
  const { me, loading } = useMe();

  const { data, isLoading, error } = useQuery({
    queryKey: ["student-results", me?.id],
    enabled: !!me?.id,
    queryFn: () => api<ResultsPayload>(`/results/student/${me?.id}`),
  });

  if (loading) {
    return (
      <AppShell>
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  const results = data?.results || [];
  const summary = data?.summary;

  return (
    <AppShell>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Link
          to="/"
          aria-label="Back"
          className="glass press grid h-11 w-11 place-items-center rounded-full"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <p className="truncate text-center font-semibold">Academic Results</p>
        <span className="h-11 w-11" />
      </header>

      {/* CGPA / SGPA Summary Card */}
      <div className="surface mt-6 overflow-hidden rounded-[26px] bg-ai p-6 text-primary-foreground shadow-float">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold opacity-90">
              <Sparkles className="h-4 w-4" /> Official Performance
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
              {summary?.cgpa ? `${summary.cgpa} SGPA` : "Results Pending"}
            </h1>
            <p className="mt-1 text-xs opacity-80">
              {summary?.totalCredits ? `${summary.totalCredits} Earned Credits` : "Evaluation ongoing"}
            </p>
          </div>
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/20 backdrop-blur-md">
            <Award className="h-7 w-7 text-white" />
          </div>
        </div>
      </div>

      {isLoading && (
        <p className="surface mt-6 rounded-2xl p-4 text-center text-xs text-muted-foreground">
          Loading your verified results…
        </p>
      )}

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Could not retrieve academic results at this time.</span>
        </div>
      )}

      {!isLoading && results.length === 0 && (
        <div className="surface mt-6 rounded-[24px] p-8 text-center text-sm text-muted-foreground">
          <BookOpen className="mx-auto h-8 w-8 opacity-40 mb-2" />
          <p className="font-medium text-foreground">No Published Results Yet</p>
          <p className="mt-1 text-xs">
            Results will appear here once officially verified and published by the examination branch.
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-6 space-y-3">
          <SectionTitle>Course Evaluation Breakdown</SectionTitle>
          <div className="space-y-2.5">
            {results.map((r) => (
              <div key={r.id} className="surface rounded-[22px] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-mono font-bold text-primary">
                        {r.subjectCode}
                      </span>
                      <p className="font-semibold truncate">{r.subjectName}</p>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {r.internalMarks !== null && (
                        <span>Internal: <strong className="text-foreground">{r.internalMarks}</strong></span>
                      )}
                      {r.externalMarks !== null && (
                        <span>External: <strong className="text-foreground">{r.externalMarks}</strong></span>
                      )}
                      {r.totalMarks !== null && (
                        <span>Total: <strong className="text-foreground">{r.totalMarks}/100</strong></span>
                      )}
                      <span>Credits: {r.credits}</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="inline-block rounded-xl bg-primary/10 px-3 py-1 text-lg font-bold text-primary">
                      {r.grade || "—"}
                    </span>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{r.gradePoints} Grade Pts</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}
