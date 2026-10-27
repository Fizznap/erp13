import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/snippet/AppShell";
import { type Subject, fetchSubjects, SUBJECTS_QUERY_KEY } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/subjects/")(
  {
    head: () => ({
      meta: [
        { title: "My classes — Snippet" },
        { name: "description", content: "Choose a subject to open its classroom, resources and study assistant." },
      ],
    }),
    component: Subjects,
  },
);

function Subjects() {
  const subjects = useQuery({
    queryKey: SUBJECTS_QUERY_KEY,
    queryFn: fetchSubjects,
  });

  return (
    <AppShell>
      <header className="rise">
        <p className="text-sm font-medium text-primary-deep">Classroom</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight">Choose a subject</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open a class to view its resources, progress and Ask Snippet study help.
        </p>
      </header>

      {subjects.isLoading && <p className="py-12 text-center text-sm text-muted-foreground">Loading subjects…</p>}
      {subjects.isError && <p className="surface mt-6 rounded-[22px] p-4 text-sm text-destructive">Could not load your subjects. Please try again.</p>}
      {!subjects.isLoading && !subjects.isError && subjects.data?.length === 0 && (
        <div className="surface mt-6 rounded-[22px] p-5 text-sm text-muted-foreground">
          No subjects have been assigned to your class yet.
        </div>
      )}

      {!subjects.isLoading && !subjects.isError && subjects.data && subjects.data.length > 0 && (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {subjects.data.map((subject) => (
            <Link
              key={subject.id}
              to="/subjects/$subjectId"
              params={{ subjectId: subject.id }}
              className="surface press rise rounded-[24px] p-5"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-lavender">
                  <BookOpen className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {subject.code}
                  </span>
                  <span className="mt-1 block font-semibold">{subject.name}</span>
                </span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {subject.division_name && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1">
                    <Users className="h-3 w-3" /> Div {subject.division_name}
                  </span>
                )}
                {subject.semester_number && <span className="rounded-full bg-muted px-2.5 py-1">Semester {subject.semester_number}</span>}
                {subject.resource_count != null && <span className="rounded-full bg-muted px-2.5 py-1">{subject.resource_count} resources</span>}
              </div>
              {subject.faculty_name && <p className="mt-3 truncate text-xs text-muted-foreground">{subject.faculty_name}</p>}
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
