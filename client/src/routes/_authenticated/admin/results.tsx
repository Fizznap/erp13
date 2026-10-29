import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Plus, Download } from "lucide-react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";

type Result = {
  id: string;
  studentId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  studentName?: string;
  rollNumber?: string;
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

export const Route = createFileRoute("/_authenticated/admin/results")({
  head: () => ({
    meta: [
      { title: "Academic Results — Admin" },
      { property: "og:title", content: "Academic Results — Admin" },
    ],
  }),
  component: ResultsManagement,
});

function ResultsManagement() {
  const { me, loading } = useMe();
  const [view, setView] = useState<"overview" | "byStudent" | "byClass">("overview");
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [results, setResults] = useState<Result[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  if (loading) {
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
        <span className="h-11 w-11" />
      </header>

      <SectionTitle>Results Management</SectionTitle>

      {/* View selector */}
      <div className="surface flex gap-2 rounded-2xl p-2">
        <button
          onClick={() => setView("overview")}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            view === "overview" ? "bg-foreground text-background" : "hover:bg-muted/50"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setView("byStudent")}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            view === "byStudent" ? "bg-foreground text-background" : "hover:bg-muted/50"
          }`}
        >
          By Student
        </button>
        <button
          onClick={() => setView("byClass")}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            view === "byClass" ? "bg-foreground text-background" : "hover:bg-muted/50"
          }`}
        >
          By Class
        </button>
      </div>

      {view === "overview" && (
        <div className="surface rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Results Overview</h3>
            <Link
              to="/admin"
              className="press flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background"
            >
              <Plus className="h-4 w-4" />
              Upload Results
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            Academic results system is active. Use the tabs above to view results by student or class.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs font-medium text-muted-foreground">Total Results</p>
              <p className="mt-1 text-2xl font-semibold">—</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs font-medium text-muted-foreground">Published</p>
              <p className="mt-1 text-2xl font-semibold">—</p>
            </div>
          </div>
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Features</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• Create and manage student results</li>
              <li>• Automatic grade calculation from marks</li>
              <li>• SGPA/CGPA computation</li>
              <li>• Bulk upload via CSV/Excel</li>
              <li>• Publish/withhold result visibility</li>
              <li>• Label synthetic/demo data clearly</li>
            </ul>
          </div>
        </div>
      )}

      {view === "byStudent" && (
        <div className="surface rounded-2xl p-4 space-y-4">
          <h3 className="font-semibold">View Results by Student</h3>
          <input
            type="text"
            placeholder="Enter student ID or roll number"
            value={selectedStudentId}
            onChange={(e) => setSelectedStudentId(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm outline-hidden focus:border-primary"
          />
          <button
            onClick={async () => {
              if (!selectedStudentId.trim()) return;
              setLoadingResults(true);
              try {
                const data = await api<{results: Result[], summary: any}>(`/results/student/${selectedStudentId}`);
                setResults(data.results);
                setSummary(data.summary);
              } catch (err) {
                console.error(err);
                alert("Could not load results");
              } finally {
                setLoadingResults(false);
              }
            }}
            disabled={!selectedStudentId.trim() || loadingResults}
            className="press w-full rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {loadingResults ? "Loading…" : "Load Results"}
          </button>

          {results.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{results.length} Results</p>
                {summary?.cgpa && (
                  <p className="text-sm">
                    <span className="font-semibold">CGPA:</span> {summary.cgpa}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                {results.map((result) => (
                  <div key={result.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium">{result.subjectName}</p>
                        <p className="text-xs text-muted-foreground">{result.subjectCode}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold">{result.grade || "—"}</p>
                        <p className="text-xs text-muted-foreground">{result.gradePoints} GP</p>
                      </div>
                    </div>
                    {result.totalMarks !== null && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Marks: {result.totalMarks}/100
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          result.status === "published"
                            ? "bg-green-500/10 text-green-600"
                            : result.status === "draft"
                              ? "bg-yellow-500/10 text-yellow-600"
                              : "bg-red-500/10 text-red-600"
                        }`}
                      >
                        {result.status}
                      </span>
                      {result.isSynthetic && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600">
                          DEMO
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.length === 0 && !loadingResults && selectedStudentId && (
            <p className="text-center text-sm text-muted-foreground py-8">
              No results found for this student.
            </p>
          )}
        </div>
      )}

      {view === "byClass" && (
        <div className="surface rounded-2xl p-4 space-y-4">
          <h3 className="font-semibold">View Results by Class</h3>
          <input
            type="text"
            placeholder="Enter class ID"
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm outline-hidden focus:border-primary"
          />
          <button
            onClick={async () => {
              if (!selectedClassId.trim()) return;
              setLoadingResults(true);
              try {
                const data = await api<{results: Result[], count: number}>(`/results/class/${selectedClassId}`);
                setResults(data.results);
              } catch (err) {
                console.error(err);
                alert("Could not load results");
              } finally {
                setLoadingResults(false);
              }
            }}
            disabled={!selectedClassId.trim() || loadingResults}
            className="press w-full rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {loadingResults ? "Loading…" : "Load Class Results"}
          </button>

          {results.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{results.length} Results</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr className="text-left">
                      <th className="pb-2 font-medium">Roll No.</th>
                      <th className="pb-2 font-medium">Student</th>
                      <th className="pb-2 font-medium">Subject</th>
                      <th className="pb-2 font-medium">Marks</th>
                      <th className="pb-2 font-medium">Grade</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {results.map((result) => (
                      <tr key={result.id}>
                        <td className="py-2">{result.rollNumber || "—"}</td>
                        <td className="py-2">{result.studentName || "—"}</td>
                        <td className="py-2">{result.subjectCode}</td>
                        <td className="py-2">{result.totalMarks ?? "—"}</td>
                        <td className="py-2 font-medium">{result.grade || "—"}</td>
                        <td className="py-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              result.status === "published"
                                ? "bg-green-500/10 text-green-600"
                                : result.status === "draft"
                                  ? "bg-yellow-500/10 text-yellow-600"
                                  : "bg-red-500/10 text-red-600"
                            }`}
                          >
                            {result.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
