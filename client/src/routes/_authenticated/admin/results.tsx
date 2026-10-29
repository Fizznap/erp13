import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  ArrowLeft,
  Plus,
  Search,
  Filter,
  CheckCircle,
  EyeOff,
  Trash2,
  AlertCircle,
  X,
  FileText,
} from "lucide-react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api, fetchSubjects, SUBJECTS_QUERY_KEY } from "@/lib/api";

type Result = {
  id: string;
  studentId: string;
  subjectId: string;
  academicClassId: string;
  subjectName: string;
  subjectCode: string;
  studentName?: string;
  rollNumber?: string;
  branchCode?: string;
  divisionName?: string;
  semesterNumber?: number;
  internalMarks: number | null;
  externalMarks: number | null;
  totalMarks: number | null;
  grade: string | null;
  gradePoints: number;
  credits: number;
  status: "draft" | "published" | "withheld";
  examType: string;
  academicYear: number;
  isSynthetic: boolean;
};

type ResultsOverviewResponse = {
  results: Result[];
  count: number;
  totalCount: number;
  publishedCount: number;
  draftCount: number;
  withheldCount: number;
};

type AcademicClass = {
  id: string;
  branch_code: string;
  branch_name?: string;
  start_year: number;
  end_year: number;
  division_name: string;
  semester_number: number;
};

export const Route = createFileRoute("/_authenticated/admin/results")({
  head: () => ({
    meta: [
      { title: "Academic Results — Admin" },
      { property: "og:title", content: "Academic Results — Admin" },
    ],
  }),
  component: ResultsManagement,
});

export function ResultsManagement() {
  const { me, loading } = useMe();
  const isAdmin = Boolean(me?.isAdmin || me?.role === "admin");
  const qc = useQueryClient();

  const [view, setView] = useState<"overview" | "byStudent" | "byClass">("overview");
  const [selectedStudentQuery, setSelectedStudentQuery] = useState<string>("");
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [showAddModal, setShowAddModal] = useState(false);

  // Form states for adding new result
  const [formStudentId, setFormStudentId] = useState("");
  const [formClassId, setFormClassId] = useState("");
  const [formSubjectId, setFormSubjectId] = useState("");
  const [formInternalMarks, setFormInternalMarks] = useState<string>("");
  const [formExternalMarks, setFormExternalMarks] = useState<string>("");
  const [formAcademicYear, setFormAcademicYear] = useState<number>(2024);
  const [formStatus, setFormStatus] = useState<"published" | "draft">("published");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Queries
  const overviewQuery = useQuery({
    queryKey: ["admin-results-overview"],
    enabled: !!me?.isAdmin,
    queryFn: () => api<ResultsOverviewResponse>("/results?limit=100"),
  });

  const hierarchyQuery = useQuery({
    queryKey: ["academic-hierarchy"],
    enabled: !!me?.isAdmin,
    queryFn: () => api<{ classes: AcademicClass[]; labGroups: any[] }>("/academic/hierarchy"),
  });

  const subjectsQuery = useQuery({
    queryKey: SUBJECTS_QUERY_KEY,
    enabled: !!me?.isAdmin,
    queryFn: fetchSubjects,
  });

  const studentsQuery = useQuery({
    queryKey: ["admin-users-students"],
    enabled: isAdmin,
    queryFn: async () => {
      const data = await api<{ users: any[] }>("/admin/users");
      return (data.users || []).filter((u) => u.role === "student");
    },
  });

  const classResultsQuery = useQuery({
    queryKey: ["admin-class-results", selectedClassId],
    enabled: isAdmin && !!selectedClassId,
    queryFn: () => api<{ results: Result[]; count: number }>(`/results/class/${selectedClassId}`),
  });

  const studentResultsQuery = useQuery({
    queryKey: ["admin-student-results", selectedStudentQuery],
    enabled: isAdmin && !!selectedStudentQuery.trim(),
    queryFn: () => api<{ results: Result[]; summary: any }>(`/results/student/${encodeURIComponent(selectedStudentQuery.trim())}`),
    retry: false,
  });

  // Calculate projected grade
  const projectedTotal = useMemo(() => {
    const im = parseFloat(formInternalMarks);
    const em = parseFloat(formExternalMarks);
    if (isNaN(im) && isNaN(em)) return null;
    return (isNaN(im) ? 0 : im) + (isNaN(em) ? 0 : em);
  }, [formInternalMarks, formExternalMarks]);

  const projectedGrade = useMemo(() => {
    if (projectedTotal === null) return "—";
    if (projectedTotal >= 90) return "O (10.0 GP)";
    if (projectedTotal >= 80) return "A+ (9.0 GP)";
    if (projectedTotal >= 70) return "A (8.0 GP)";
    if (projectedTotal >= 60) return "B+ (7.0 GP)";
    if (projectedTotal >= 55) return "B (6.0 GP)";
    if (projectedTotal >= 50) return "C (5.0 GP)";
    if (projectedTotal >= 40) return "P (4.0 GP)";
    return "F (0.0 GP)";
  }, [projectedTotal]);

  const handleCreateResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formStudentId || !formClassId || !formSubjectId) {
      setFormError("Student, class, and subject are required.");
      return;
    }
    setFormSubmitting(true);
    setFormError("");
    try {
      await api("/results", {
        method: "POST",
        body: {
          studentId: formStudentId,
          academicClassId: formClassId,
          subjectId: formSubjectId,
          internalMarks: formInternalMarks !== "" ? parseFloat(formInternalMarks) : null,
          externalMarks: formExternalMarks !== "" ? parseFloat(formExternalMarks) : null,
          totalMarks: projectedTotal,
          academicYear: formAcademicYear,
          status: formStatus,
        },
      });
      await qc.invalidateQueries({ queryKey: ["admin-results-overview"] });
      if (selectedClassId === formClassId) {
        await qc.invalidateQueries({ queryKey: ["admin-class-results", formClassId] });
      }
      setShowAddModal(false);
      setFormInternalMarks("");
      setFormExternalMarks("");
    } catch (err: any) {
      setFormError(err.message || "Failed to create result");
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleToggleStatus = async (result: Result) => {
    const nextStatus = result.status === "published" ? "draft" : "published";
    try {
      await api(`/results/${result.id}`, {
        method: "PATCH",
        body: { status: nextStatus },
      });
      await qc.invalidateQueries({ queryKey: ["admin-results-overview"] });
      if (selectedClassId) {
        await qc.invalidateQueries({ queryKey: ["admin-class-results", selectedClassId] });
      }
      if (selectedStudentQuery) {
        await qc.invalidateQueries({ queryKey: ["admin-student-results", selectedStudentQuery] });
      }
    } catch (err: any) {
      alert(err.message || "Failed to update result status");
    }
  };

  const handleDeleteResult = async (id: string) => {
    if (!confirm("Are you sure you want to delete this result?")) return;
    try {
      await api(`/results/${id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["admin-results-overview"] });
      if (selectedClassId) {
        await qc.invalidateQueries({ queryKey: ["admin-class-results", selectedClassId] });
      }
      if (selectedStudentQuery) {
        await qc.invalidateQueries({ queryKey: ["admin-student-results", selectedStudentQuery] });
      }
    } catch (err: any) {
      alert(err.message || "Failed to delete result");
    }
  };

  if (loading) {
    return (
      <AppShell>
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <p className="surface mt-6 rounded-[22px] p-4 text-sm text-muted-foreground">
          Admin access required.
        </p>
      </AppShell>
    );
  }

  const overview = overviewQuery.data;
  const classes = hierarchyQuery.data?.classes || [];
  const subjects = subjectsQuery.data || [];
  const students = studentsQuery.data || [];

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
        <p className="truncate text-center font-semibold">Academic Results</p>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="press flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background"
          aria-label="Add Result"
        >
          <Plus className="h-5 w-5" />
        </button>
      </header>

      {/* View Selector */}
      <div className="surface mt-6 flex gap-2 rounded-2xl p-1.5">
        <button
          type="button"
          onClick={() => setView("overview")}
          className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-colors ${
            view === "overview" ? "bg-foreground text-background shadow-xs" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setView("byClass")}
          className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-colors ${
            view === "byClass" ? "bg-foreground text-background shadow-xs" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          By Class
        </button>
        <button
          type="button"
          onClick={() => setView("byStudent")}
          className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-colors ${
            view === "byStudent" ? "bg-foreground text-background shadow-xs" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          By Student
        </button>
      </div>

      {/* OVERVIEW TAB */}
      {view === "overview" && (
        <div className="mt-6 space-y-4">
          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="surface rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold">{overview?.totalCount ?? "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Total Results</p>
            </div>
            <div className="surface rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{overview?.publishedCount ?? "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Published</p>
            </div>
            <div className="surface rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{overview?.draftCount ?? "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Drafts</p>
            </div>
            <div className="surface rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-rose-600">{overview?.withheldCount ?? "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Withheld</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <SectionTitle>Recent Academic Records</SectionTitle>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="press inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
            >
              <Plus className="h-3.5 w-3.5" /> Add Result
            </button>
          </div>

          {overviewQuery.isLoading && (
            <p className="surface rounded-2xl p-6 text-center text-xs text-muted-foreground">
              Loading recent results…
            </p>
          )}

          {overview && overview.results.length === 0 && (
            <div className="surface rounded-2xl p-8 text-center text-sm text-muted-foreground">
              <FileText className="mx-auto h-8 w-8 opacity-40 mb-2" />
              <p className="font-semibold text-foreground">No Academic Results Found</p>
              <p className="mt-1 text-xs">
                Use the "Add Result" button above to upload student marks and official grades.
              </p>
            </div>
          )}

          {overview && overview.results.length > 0 && (
            <div className="space-y-2.5">
              {overview.results.map((r) => (
                <div key={r.id} className="surface flex items-center justify-between gap-3 rounded-[20px] p-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-primary">
                        {r.rollNumber || "ID"}
                      </span>
                      <p className="truncate text-sm font-semibold">{r.studentName || "Student"}</p>
                      {r.isSynthetic && (
                        <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
                          DEMO
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.subjectCode} · {r.subjectName} · {r.totalMarks !== null ? `${r.totalMarks}/100` : "No marks"}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-base font-bold">{r.grade || "—"}</p>
                      <p className="text-[10px] text-muted-foreground">{r.gradePoints} GP</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleStatus(r)}
                      title={r.status === "published" ? "Mark Draft" : "Publish"}
                      className={`press rounded-full p-2 ${
                        r.status === "published"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      {r.status === "published" ? <CheckCircle className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteResult(r.id)}
                      title="Delete"
                      className="press rounded-full p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BY CLASS TAB */}
      {view === "byClass" && (
        <div className="mt-6 space-y-4">
          <div className="surface rounded-2xl p-4 space-y-3">
            <label className="text-xs font-semibold text-muted-foreground">Select Academic Class</label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-hidden focus:border-primary"
            >
              <option value="">-- Choose Class --</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.branch_code} Div {c.division_name} (Sem {c.semester_number}) [{c.start_year}-{c.end_year}]
                </option>
              ))}
            </select>
          </div>

          {selectedClassId && classResultsQuery.isLoading && (
            <p className="surface rounded-2xl p-6 text-center text-xs text-muted-foreground">
              Loading class results…
            </p>
          )}

          {selectedClassId && classResultsQuery.data && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">
                  {classResultsQuery.data.count} Results Recorded
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFormClassId(selectedClassId);
                    setShowAddModal(true);
                  }}
                  className="press inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Result for Class
                </button>
              </div>

              {classResultsQuery.data.results.length === 0 ? (
                <div className="surface rounded-2xl p-6 text-center text-xs text-muted-foreground">
                  No results entered for this class yet. Click "Add Result for Class" above.
                </div>
              ) : (
                <div className="surface overflow-x-auto rounded-2xl p-2">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="p-2.5">Roll No.</th>
                        <th className="p-2.5">Student</th>
                        <th className="p-2.5">Subject</th>
                        <th className="p-2.5">Marks</th>
                        <th className="p-2.5">Grade</th>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {classResultsQuery.data.results.map((r) => (
                        <tr key={r.id} className="hover:bg-accent/40">
                          <td className="p-2.5 font-mono font-bold">{r.rollNumber || "—"}</td>
                          <td className="p-2.5 font-semibold">{r.studentName || "—"}</td>
                          <td className="p-2.5">{r.subjectCode}</td>
                          <td className="p-2.5">{r.totalMarks !== null ? `${r.totalMarks}/100` : "—"}</td>
                          <td className="p-2.5 font-bold">{r.grade || "—"}</td>
                          <td className="p-2.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                r.status === "published"
                                  ? "bg-emerald-500/10 text-emerald-600"
                                  : "bg-amber-500/10 text-amber-600"
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="p-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(r)}
                              className="text-muted-foreground hover:text-foreground mr-2"
                              title="Toggle Publish"
                            >
                              {r.status === "published" ? "Unpublish" : "Publish"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteResult(r.id)}
                              className="text-destructive hover:underline"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* BY STUDENT TAB */}
      {view === "byStudent" && (
        <div className="mt-6 space-y-4">
          <div className="surface rounded-2xl p-4 space-y-3">
            <label className="text-xs font-semibold text-muted-foreground">Search Student by Roll Number or ID</label>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="e.g. UST24R0102086 or student email"
                value={selectedStudentQuery}
                onChange={(e) => setSelectedStudentQuery(e.target.value)}
                className="w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5 text-sm outline-hidden focus:border-primary"
              />
            </div>

            {/* Quick Suggestions */}
            {students.length > 0 && !selectedStudentQuery && (
              <div className="pt-2">
                <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Quick select demo student:</p>
                <div className="flex flex-wrap gap-1.5">
                  {students.slice(0, 5).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedStudentQuery(s.profile?.roll_number || s.email)}
                      className="press rounded-full bg-accent px-2.5 py-1 text-xs text-accent-foreground hover:bg-accent/80"
                    >
                      {s.full_name} ({s.profile?.roll_number || s.email.split("@")[0]})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {selectedStudentQuery.trim() && studentResultsQuery.isLoading && (
            <p className="surface rounded-2xl p-6 text-center text-xs text-muted-foreground">
              Looking up student performance records…
            </p>
          )}

          {studentResultsQuery.isError && (
            <div className="surface rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
              Student not found or no results recorded.
            </div>
          )}

          {studentResultsQuery.data && (
            <div className="space-y-4">
              <div className="surface flex items-center justify-between rounded-2xl p-4">
                <div>
                  <p className="text-xs text-muted-foreground">Cumulative Grade Point</p>
                  <p className="text-2xl font-bold">{studentResultsQuery.data.summary?.cgpa ? `${studentResultsQuery.data.summary.cgpa} CGPA` : "—"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Earned Credits</p>
                  <p className="text-lg font-bold">{studentResultsQuery.data.summary?.totalCredits ?? "—"}</p>
                </div>
              </div>

              <div className="space-y-2">
                {studentResultsQuery.data.results.map((r) => (
                  <div key={r.id} className="surface flex items-center justify-between rounded-2xl p-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-primary">{r.subjectCode}</span>
                        <p className="font-semibold text-sm">{r.subjectName}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Internal: {r.internalMarks ?? "—"} · External: {r.externalMarks ?? "—"} · Total: {r.totalMarks ?? "—"}/100
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-lg font-bold">{r.grade || "—"}</p>
                        <p className="text-[10px] text-muted-foreground">{r.gradePoints} GP</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(r)}
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          r.status === "published"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-amber-500/10 text-amber-600"
                        }`}
                      >
                        {r.status}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ADD RESULT MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="surface w-full max-w-md rounded-[28px] border border-border p-6 shadow-float">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Add Academic Result</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="press rounded-full p-1.5 text-muted-foreground hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateResult} className="mt-4 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Academic Class</label>
                <select
                  required
                  value={formClassId}
                  onChange={(e) => setFormClassId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                >
                  <option value="">-- Select Class --</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.branch_code} Div {c.division_name} (Sem {c.semester_number})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Student</label>
                <select
                  required
                  value={formStudentId}
                  onChange={(e) => setFormStudentId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                >
                  <option value="">-- Select Student --</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} ({s.profile?.roll_number || s.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Subject</label>
                <select
                  required
                  value={formSubjectId}
                  onChange={(e) => setFormSubjectId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                >
                  <option value="">-- Select Subject --</option>
                  {subjects.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Internal (max 30/40)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={formInternalMarks}
                    onChange={(e) => setFormInternalMarks(e.target.value)}
                    placeholder="e.g. 27"
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">External (max 70/60)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={formExternalMarks}
                    onChange={(e) => setFormExternalMarks(e.target.value)}
                    placeholder="e.g. 61"
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                  />
                </div>
              </div>

              {/* Live Preview */}
              <div className="rounded-xl border border-border bg-card/60 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Computed Total:</span>
                  <span className="font-bold">{projectedTotal !== null ? `${projectedTotal} / 100` : "—"}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Auto Grade:</span>
                  <span className="font-bold text-primary">{projectedGrade}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Academic Year</label>
                  <input
                    type="number"
                    min="2020"
                    max="2030"
                    value={formAcademicYear}
                    onChange={(e) => setFormAcademicYear(parseInt(e.target.value, 10))}
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Initial Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                  >
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="press flex-1 rounded-xl border border-border py-2 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="press flex-1 rounded-xl bg-foreground py-2 text-sm font-semibold text-background disabled:opacity-50"
                >
                  {formSubmitting ? "Saving…" : "Save Result"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
