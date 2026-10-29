import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  Award,
  Sparkles,
  ChevronRight,
  BookOpen,
  Radio,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  FlaskConical,
  Presentation,
} from "lucide-react";
import { AppShell } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { parseAttendanceHistoryResponse, uniqueAttendanceHistory } from "@/lib/attendance";
import { acquireAttendanceLocation, type LocationError } from "@/lib/geolocation";

type AcademicResult = {
  id: string;
  studentId: string;
  subjectId: string;
  academicClassId: string;
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

type AcademicTerm = {
  termId: string;
  termTitle: string;
  semesterNumber: number;
  academicYear: number;
  batch: string;
  divisionName?: string;
  branchCode?: string;
  branchName?: string;
  declarationDate: string;
  status: "published" | "draft" | "withheld";
  sgpa: string;
  earnedCredits: number;
  totalCourses: number;
  results: AcademicResult[];
};

type ResultsPayload = {
  results: AcademicResult[];
  terms?: AcademicTerm[];
  summary: {
    totalResults: number;
    totalCredits: number;
    cgpa: string;
    declaredTermsCount?: number;
    pendingTermsCount?: number;
  };
};

type AttendanceSubject = {
  offeringId: string;
  subjectId: string;
  name: string;
  code: string;
  isLab: boolean;
  facultyName: string | null;
  attended: number;
  total: number;
  percentage: number;
};

type AttendanceOverviewPayload = {
  semesters: Array<{
    semesterNumber: number;
    academicClassId: string;
    label: string;
    isCurrent: boolean;
  }>;
  selectedSemester: number;
  overall: {
    percentage: number;
    attended: number;
    total: number;
  };
  subjects: AttendanceSubject[];
};

export function CircularProgressRing({ value, size = 88, strokeWidth = 8 }: { value: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference;

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        className="stroke-muted/40"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        stroke="#f43f5e"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-1000 ease-out"
      />
    </svg>
  );
}

export function GradeBadge({ grade }: { grade: string | null }) {
  const g = (grade || "").toUpperCase();
  let color = "bg-primary/20 text-primary border-primary/30";
  if (g === "O") color = "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
  else if (g === "A+") color = "bg-teal-500/20 text-teal-600 dark:text-teal-400 border-teal-500/30";
  else if (g === "A") color = "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30";
  else if (g === "B+" || g === "B") color = "bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30";
  else if (g === "C" || g === "P") color = "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30";
  else if (g === "F" || g === "AB") color = "bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/30";

  return (
    <span className={`inline-block rounded-xl border px-2.5 py-1 text-xs font-bold tracking-wide ${color}`}>
      {grade || "—"}
    </span>
  );
}

export function StudentAcademics({ initialTab = "currentTerm" }: { initialTab?: "currentTerm" | "examResults" }) {
  const { me, loading } = useMe();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<"currentTerm" | "examResults">(initialTab);
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null);
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);

  // Mark attendance state
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [markedDone, setMarkedDone] = useState<string | null>(null);
  const [submittingCode, setSubmittingCode] = useState(false);
  const [locationStatus, setLocationStatus] = useState<"idle" | "acquiring" | "acquired" | "failed">("idle");

  // Fetch Attendance Overview
  const attendanceQuery = useQuery({
    queryKey: ["attendance-overview", selectedSemester],
    enabled: !!me?.id,
    queryFn: () => {
      const url = selectedSemester
        ? `/attendance/my/overview?semester=${selectedSemester}`
        : `/attendance/my/overview`;
      return api<AttendanceOverviewPayload>(url);
    },
  });

  // Fetch Student Results
  const resultsQuery = useQuery({
    queryKey: ["student-results", me?.id],
    enabled: !!me?.id,
    queryFn: () => api<ResultsPayload>(`/results/student/${me?.id}`),
  });

  // Fetch Attendance Records History
  const historyQuery = useQuery({
    queryKey: ["my-history"],
    enabled: !!me?.id,
    queryFn: async () => {
      const response = await api<unknown>("/attendance/my/records");
      return parseAttendanceHistoryResponse(response);
    },
  });
  const records = useMemo(() => uniqueAttendanceHistory(historyQuery.data), [historyQuery.data]);

  // Handle Mark Attendance
  const handleMarkAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCode(true);
    setCodeError("");
    setLocationStatus("acquiring");

    try {
      const location = await acquireAttendanceLocation({
        maxAccuracyMeters: 30,
        timeoutMs: 15000,
        maxAttempts: 3,
      });

      setLocationStatus("acquired");
      const res = await api<{ status: string; distance?: number }>("/attendance/mark", {
        method: "POST",
        body: {
          nonce: code,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          timestamp: location.timestamp,
        },
      });

      setMarkedDone(`Marked present (${Math.round(res.distance || 0)}m from session)`);
      setCode("");
      setLocationStatus("idle");
      await qc.invalidateQueries({ queryKey: ["attendance-overview"] });
      await qc.invalidateQueries({ queryKey: ["my-history"] });
    } catch (err: any) {
      setLocationStatus("failed");
      if (err.code) {
        const locError = err as LocationError;
        setCodeError(locError.message || "Failed to obtain GPS coordinates.");
      } else {
        setCodeError(err.message || "Could not mark attendance.");
      }
    } finally {
      setSubmittingCode(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <p className="mt-6 text-sm text-muted-foreground">Loading academics…</p>
      </AppShell>
    );
  }

  const attendanceData = attendanceQuery.data;
  const resultsData = resultsQuery.data;

  // Selected term details if student clicked a term
  const activeTerm = resultsData?.terms?.find((t) => t.termId === selectedTermId);

  return (
    <AppShell>
      {/* Top Header */}
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Link to="/" aria-label="Back" className="glass press grid h-11 w-11 place-items-center rounded-full">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <p className="truncate text-center font-semibold">Academics</p>
        {me?.isFaculty ? (
          <Link
            to="/faculty"
            className="press glass flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
          >
            <Presentation className="h-4 w-4" /> Faculty
          </Link>
        ) : (
          <span className="h-11 w-11" />
        )}
      </header>

      {/* Tabs Switcher: Current Term vs Exam Results */}
      <div className="surface mt-6 flex gap-2 rounded-2xl p-1.5 shadow-xs">
        <button
          type="button"
          onClick={() => {
            setActiveTab("currentTerm");
            setSelectedTermId(null);
          }}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-colors ${
            activeTab === "currentTerm"
              ? "bg-foreground text-background shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Calendar className="h-3.5 w-3.5 text-rose-500" /> Current Term
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("examResults")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-colors ${
            activeTab === "examResults"
              ? "bg-foreground text-background shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Award className="h-3.5 w-3.5 text-amber-500" /> Exam Results
        </button>
      </div>

      {/* ============================================================== */}
      {/* TAB 1: CURRENT TERM (Attendance Breakdown)                     */}
      {/* ============================================================== */}
      {activeTab === "currentTerm" && (
        <div className="mt-6 space-y-5">
          {/* Semester Selector */}
          {attendanceData?.semesters && attendanceData.semesters.length > 0 && (
            <div>
              <label htmlFor="semester-selector" className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Academic Semester
              </label>
              <select
                id="semester-selector"
                value={selectedSemester || attendanceData.selectedSemester}
                onChange={(e) => setSelectedSemester(parseInt(e.target.value, 10))}
                className="mt-1.5 w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm font-semibold outline-hidden focus:border-rose-500"
              >
                {attendanceData.semesters.map((sem) => (
                  <option key={sem.semesterNumber} value={sem.semesterNumber}>
                    {sem.label} {sem.isCurrent ? "(Current)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Overall Attendance Card (Dark Charcoal, Coral/Rose Ring) */}
          <div className="surface relative overflow-hidden rounded-[26px] border border-border bg-card p-6 shadow-float">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-bold text-rose-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" /> Overall Attendance
                </span>
                <h2 className="mt-2 text-3xl font-extrabold tracking-tight">
                  {attendanceData?.overall?.percentage != null ? `${attendanceData.overall.percentage}%` : "—"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {attendanceData?.overall
                    ? `${attendanceData.overall.attended} of ${attendanceData.overall.total} sessions attended`
                    : "No attendance recorded yet"}
                </p>
              </div>

              <div className="relative grid place-items-center">
                <CircularProgressRing value={attendanceData?.overall?.percentage ?? 0} size={88} strokeWidth={8} />
                <span className="absolute text-xs font-bold text-rose-500">
                  {Math.round(attendanceData?.overall?.percentage ?? 0)}%
                </span>
              </div>
            </div>
          </div>

          {/* Subject-Wise Breakdown Cards */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">Subject-Wise Breakdown</h3>
              <span className="text-xs text-muted-foreground">
                {attendanceData?.subjects?.length ?? 0} Offerings
              </span>
            </div>

            {attendanceQuery.isLoading && (
              <p className="surface rounded-2xl p-6 text-center text-xs text-muted-foreground">
                Loading subject attendance…
              </p>
            )}

            {attendanceData?.subjects?.length === 0 && !attendanceQuery.isLoading && (
              <div className="surface rounded-2xl p-6 text-center text-xs text-muted-foreground">
                No subjects or sessions found for this semester.
              </div>
            )}

            <div className="space-y-3">
              {attendanceData?.subjects?.map((subj) => (
                <div key={subj.offeringId || subj.subjectId} className="surface rounded-[22px] border border-border p-4.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-primary">{subj.code}</span>
                        {subj.isLab && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-bold text-purple-600 dark:text-purple-400">
                            <FlaskConical className="h-3 w-3" /> LAB
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-semibold leading-snug">{subj.name}</p>
                      {subj.facultyName && (
                        <p className="mt-0.5 text-xs text-muted-foreground">Faculty: {subj.facultyName}</p>
                      )}
                    </div>

                    <div className="text-right">
                      <span className="text-base font-bold text-rose-500">{subj.percentage}%</span>
                      <p className="text-[11px] text-muted-foreground">
                        {subj.attended} / {subj.total} sessions
                      </p>
                    </div>
                  </div>

                  {/* Horizontal progress bar */}
                  <div className="mt-3.5 h-2 w-full overflow-hidden rounded-full bg-muted/60">
                    <div
                      className="h-full rounded-full bg-rose-500 transition-all duration-700 ease-out"
                      style={{ width: `${Math.min(100, subj.percentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Mark Attendance Action */}
          <div className="surface mt-6 rounded-[24px] border border-border p-5 shadow-xs">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <Radio className="h-4 w-4 text-emerald-500 animate-pulse" /> Submit Live Attendance
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter the 6-character code presented by your faculty during an active session.
            </p>

            {markedDone ? (
              <div className="mt-4 flex flex-col items-center py-2 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                <p className="mt-2 text-sm font-semibold">{markedDone}</p>
                <button
                  type="button"
                  onClick={() => setMarkedDone(null)}
                  className="mt-2 text-xs text-primary underline"
                >
                  Enter another code
                </button>
              </div>
            ) : (
              <form onSubmit={handleMarkAttendance} className="mt-3 space-y-3">
                <input
                  type="text"
                  maxLength={6}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase().slice(0, 6));
                    setCodeError("");
                  }}
                  placeholder="••••••"
                  className="w-full rounded-xl border border-border bg-card py-3 text-center font-mono text-2xl font-bold tracking-[0.4em] outline-hidden focus:border-rose-500"
                />

                {locationStatus === "acquiring" && (
                  <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying classroom GPS location…
                  </p>
                )}

                {codeError && (
                  <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{codeError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submittingCode || code.length !== 6}
                  className="press w-full rounded-xl bg-foreground py-2.5 text-xs font-semibold text-background disabled:opacity-50"
                >
                  {submittingCode ? "Submitting…" : "Mark Present"}
                </button>
              </form>
            )}
          </div>

          {/* Recent Attendance Session Logs */}
          <div className="surface divide-y divide-border rounded-[24px]">
            <div className="p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recent Attendance Logs
              </h4>
            </div>
            {historyQuery.isLoading && (
              <p className="p-4 text-xs text-muted-foreground">Loading recent logs…</p>
            )}
            {!historyQuery.isError && records.length === 0 && !historyQuery.isLoading && (
              <p className="p-4 text-xs text-muted-foreground">No recent attendance records found.</p>
            )}
            {records.slice(0, 15).map((h) => (
              <div key={h.session_id ?? h.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{h.subject_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {h.session_date
                      ? new Date(h.session_date).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                    h.status === "present"
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {h.status === "present" ? "PRESENT" : "ABSENT"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: EXAM RESULTS                                            */}
      {/* ============================================================== */}
      {activeTab === "examResults" && (
        <div className="mt-6 space-y-5">
          {/* A. If a term is currently selected -> Individual Term Result View */}
          {activeTerm ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setSelectedTermId(null)}
                className="press inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to All Terms
              </button>

              {/* Term Overview Banner */}
              <div className="surface rounded-[26px] bg-ai p-6 text-primary-foreground shadow-float">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold backdrop-blur-md">
                      <Sparkles className="h-3.5 w-3.5" /> {activeTerm.termTitle}
                    </span>
                    <h2 className="mt-2 text-3xl font-extrabold tracking-tight">
                      {activeTerm.sgpa} SGPA
                    </h2>
                    <p className="mt-1 text-xs opacity-85">
                      {activeTerm.earnedCredits} Earned Credits · {activeTerm.totalCourses} Courses Evaluated
                    </p>
                    <p className="mt-0.5 text-[11px] opacity-75">
                      {activeTerm.branchCode} · {activeTerm.batch} · Div {activeTerm.divisionName || "B"}
                    </p>
                  </div>
                  <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/20 backdrop-blur-md">
                    <Award className="h-7 w-7 text-white" />
                  </div>
                </div>
              </div>

              {/* Individual Course Cards */}
              <div className="space-y-3 pt-2">
                <h3 className="text-sm font-semibold tracking-tight">Course Evaluations</h3>
                {activeTerm.results.map((course) => (
                  <div key={course.id} className="surface rounded-[22px] border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-xs font-bold text-primary">{course.subjectCode}</span>
                        <h4 className="mt-0.5 font-semibold text-foreground leading-snug">{course.subjectName}</h4>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {course.credits} Credits · {course.examType.toUpperCase()}
                        </p>
                      </div>

                      <div className="text-right">
                        <GradeBadge grade={course.grade} />
                        <p className="mt-1.5 text-xs font-bold text-foreground">
                          {course.totalMarks !== null ? `${course.totalMarks}/100` : "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{course.gradePoints} GP</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* B. Terms Overview List View */
            <div className="space-y-5">
              {/* Overall Performance Card */}
              <div className="surface rounded-[26px] bg-ai p-6 text-primary-foreground shadow-float">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold backdrop-blur-md">
                      <Sparkles className="h-3.5 w-3.5" /> Official Performance Record
                    </span>
                    <h2 className="mt-2 text-3xl font-extrabold tracking-tight">
                      {resultsData?.summary?.cgpa ? `${resultsData.summary.cgpa} CGPA` : "Results Pending"}
                    </h2>
                    <p className="mt-1 text-xs opacity-85">
                      {resultsData?.summary?.totalCredits ? `${resultsData.summary.totalCredits} Total Earned Credits` : "Evaluation ongoing"}
                    </p>
                  </div>
                  <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/20 backdrop-blur-md">
                    <Award className="h-7 w-7 text-white" />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2 border-t border-white/15 pt-4 text-xs opacity-90">
                  <div>
                    <span className="text-[11px] opacity-75">Declared Terms:</span>
                    <p className="font-bold">{resultsData?.summary?.declaredTermsCount ?? resultsData?.terms?.length ?? 1}</p>
                  </div>
                  <div>
                    <span className="text-[11px] opacity-75">Pending Terms:</span>
                    <p className="font-bold">{resultsData?.summary?.pendingTermsCount ?? 0}</p>
                  </div>
                </div>
              </div>

              {/* Published Academic Terms List */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold tracking-tight">Declared Academic Terms</h3>
                  <span className="text-xs text-muted-foreground">
                    {resultsData?.terms?.length ?? 0} Declared
                  </span>
                </div>

                {resultsQuery.isLoading && (
                  <p className="surface rounded-2xl p-6 text-center text-xs text-muted-foreground">
                    Loading academic records…
                  </p>
                )}

                {resultsData?.terms?.length === 0 && !resultsQuery.isLoading && (
                  <div className="surface rounded-2xl p-6 text-center text-xs text-muted-foreground">
                    No academic terms have been published yet for your account.
                  </div>
                )}

                <div className="space-y-3">
                  {resultsData?.terms?.map((term) => (
                    <div
                      key={term.termId}
                      onClick={() => setSelectedTermId(term.termId)}
                      className="surface press flex items-center justify-between gap-3 rounded-[22px] border border-border p-4.5 cursor-pointer hover:border-primary/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{term.termTitle}</span>
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                            {term.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {term.batch} · {term.totalCourses} Courses · {term.earnedCredits} Credits
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Declared on {new Date(term.declarationDate).toLocaleDateString()}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-base font-bold text-primary">{term.sgpa}</span>
                          <p className="text-[10px] text-muted-foreground">SGPA</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
