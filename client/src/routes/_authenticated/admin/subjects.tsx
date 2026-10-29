import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Plus, BookOpen, Layers, Check, AlertCircle } from "lucide-react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api, fetchSubjects, SUBJECTS_QUERY_KEY } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/admin/subjects")({
  head: () => ({
    meta: [
      { title: "Subjects & Offerings — Admin" },
      { property: "og:title", content: "Subjects & Offerings — Admin" },
    ],
  }),
  component: SubjectsManagement,
});

type SubjectItem = {
  id: string;
  name: string;
  code: string;
  description?: string;
  offering_id?: string;
  faculty_name?: string;
  branch_name?: string;
  division_name?: string;
  semester_number?: number;
  resource_count?: string | number;
};

type AcademicClass = {
  id: string;
  branch_code: string;
  start_year: number;
  end_year: number;
  division_name: string;
  semester_number: number;
};

type FacultyUser = {
  id: string;
  full_name: string;
  email: string;
};

export function SubjectsManagement() {
  const { me, loading: meLoading } = useMe();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<"list" | "create" | "offerings">("list");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const subjects = useQuery({
    queryKey: SUBJECTS_QUERY_KEY,
    enabled: !!me?.isAdmin,
    queryFn: fetchSubjects,
  });

  const hierarchy = useQuery({
    queryKey: ["academic-hierarchy"],
    enabled: !!me?.isAdmin,
    queryFn: async () => {
      return api<{
        classes: AcademicClass[];
        faculty: FacultyUser[];
        subjects: Array<{ id: string; name: string; code: string }>;
      }>("/academic/hierarchy");
    },
  });

  if (meLoading) {
    return (
      <AppShell>
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  if (!me?.isAdmin) {
    return (
      <AppShell>
        <p className="surface mt-6 rounded-[22px] p-4 text-sm text-muted-foreground">
          Admin access required.
        </p>
      </AppShell>
    );
  }

  // Deduplicate base subjects for list
  const uniqueSubjectsMap = new Map<string, SubjectItem>();
  (subjects.data || []).forEach((s: any) => {
    if (!uniqueSubjectsMap.has(s.id)) {
      uniqueSubjectsMap.set(s.id, s);
    }
  });
  const uniqueSubjects = Array.from(uniqueSubjectsMap.values());

  const handleCreateSubject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      await api("/subjects", {
        method: "POST",
        body: {
          name: fd.get("name"),
          code: fd.get("code"),
          description: fd.get("description"),
        },
      });
      await qc.invalidateQueries({ queryKey: SUBJECTS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ["academic-hierarchy"] });
      setSuccessMsg("Subject created successfully!");
      (e.target as HTMLFormElement).reset();
      setActiveTab("list");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create subject");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignOffering = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      await api("/subjects/offerings", {
        method: "POST",
        body: {
          subjectId: fd.get("subjectId"),
          academicClassId: fd.get("academicClassId"),
          facultyId: fd.get("facultyId"),
        },
      });
      await qc.invalidateQueries({ queryKey: SUBJECTS_QUERY_KEY });
      setSuccessMsg("Subject offering successfully assigned to class!");
      (e.target as HTMLFormElement).reset();
      setActiveTab("list");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to assign subject offering");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Link
          to="/admin"
          aria-label="Back"
          className="glass press grid h-11 w-11 place-items-center rounded-full"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <p className="truncate text-center font-semibold">Subjects & Offerings</p>
        <span className="h-11 w-11" />
      </header>

      {/* Navigation tabs */}
      <div className="surface mt-6 flex gap-2 rounded-2xl p-2">
        <button
          onClick={() => setActiveTab("list")}
          className={`flex-1 rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
            activeTab === "list" ? "bg-foreground text-background" : "hover:bg-muted/50"
          }`}
        >
          All Subjects ({uniqueSubjects.length})
        </button>
        <button
          onClick={() => setActiveTab("create")}
          className={`flex-1 rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
            activeTab === "create" ? "bg-foreground text-background" : "hover:bg-muted/50"
          }`}
        >
          + Add Subject
        </button>
        <button
          onClick={() => setActiveTab("offerings")}
          className={`flex-1 rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
            activeTab === "offerings" ? "bg-foreground text-background" : "hover:bg-muted/50"
          }`}
        >
          Assign to Class
        </button>
      </div>

      {errorMsg && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
          <Check className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {activeTab === "list" && (
        <div className="mt-6 space-y-3">
          <SectionTitle>Curriculum Subjects</SectionTitle>
          {subjects.isLoading && (
            <p className="surface rounded-2xl p-4 text-center text-xs text-muted-foreground">
              Loading curriculum subjects…
            </p>
          )}

          {uniqueSubjects.length === 0 && !subjects.isLoading && (
            <div className="surface rounded-[22px] p-6 text-center text-xs text-muted-foreground">
              No subjects created yet. Click "+ Add Subject" to add your first subject.
            </div>
          )}

          {uniqueSubjects.map((sub: any) => (
            <div key={sub.id} className="surface rounded-[22px] p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-mono font-bold text-primary">
                      {sub.code}
                    </span>
                    <p className="font-semibold">{sub.name}</p>
                  </div>
                  {sub.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{sub.description}</p>
                  )}
                  {sub.faculty_name && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Faculty: <span className="text-foreground">{sub.faculty_name}</span>
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-foreground">
                    {sub.resource_count ?? 0} Resources
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "create" && (
        <div className="surface mt-6 rounded-[22px] p-5">
          <SectionTitle>New Academic Subject</SectionTitle>
          <form onSubmit={handleCreateSubject} className="mt-3 space-y-3 text-sm">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Subject Name
              </label>
              <input
                name="name"
                required
                placeholder="e.g. Distributed Database Systems"
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Subject Code
              </label>
              <input
                name="code"
                required
                placeholder="e.g. CS501"
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Description (Optional)
              </label>
              <textarea
                name="description"
                rows={3}
                placeholder="Brief course objectives and syllabus details"
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="press w-full rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Save Subject"}
            </button>
          </form>
        </div>
      )}

      {activeTab === "offerings" && (
        <div className="surface mt-6 rounded-[22px] p-5">
          <SectionTitle>Assign Subject Offering</SectionTitle>
          <p className="mt-1 text-xs text-muted-foreground mb-4">
            Connect a subject to an academic class section and designate the teaching faculty member.
          </p>
          <form onSubmit={handleAssignOffering} className="space-y-3 text-sm">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Select Subject
              </label>
              <select
                name="subjectId"
                required
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none"
              >
                <option value="">Choose subject…</option>
                {uniqueSubjects.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Target Academic Class
              </label>
              <select
                name="academicClassId"
                required
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none"
              >
                <option value="">Choose class…</option>
                {hierarchy.data?.classes?.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.branch_code} | {c.start_year}-{c.end_year} | Div {c.division_name} | Sem {c.semester_number}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Assigned Faculty
              </label>
              <select
                name="facultyId"
                required
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs outline-none"
              >
                <option value="">Choose faculty…</option>
                {hierarchy.data?.faculty?.map((f: any) => (
                  <option key={f.id} value={f.id}>
                    {f.full_name} ({f.email})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="press w-full rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {submitting ? "Assigning…" : "Assign Offering"}
            </button>
          </form>
        </div>
      )}
    </AppShell>
  );
}
