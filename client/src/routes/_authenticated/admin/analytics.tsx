import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Users,
  Award,
  CalendarCheck,
  Sparkles,
  AlertTriangle,
  BookOpen,
  TrendingUp,
  TrendingDown,
  Clock,
} from "lucide-react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics & Reports — Admin" },
      { property: "og:title", content: "Analytics & Reports — Admin" },
      {
        name: "description",
        content: "Institutional analytics, attendance trends, and academic performance.",
      },
    ],
  }),
  component: Analytics,
});

type AnalyticsData = {
  overview: {
    student_count: string;
    faculty_count: string;
    subject_count: string;
    class_count: string;
    avg_marks: string | null;
    avg_cgpa: string | null;
  };
  attendance: {
    total_records: string;
    present_records: string;
    absent_records: string;
    corrected_records: string;
    overall_rate: string;
  };
  atRiskStudents: Array<{
    student_id: string;
    full_name: string;
    email: string;
    roll_number: string | null;
    total_sessions: string;
    attended_sessions: string;
    attendance_percentage: string;
    cgpa: string | null;
  }>;
  subjectPerformance: Array<{
    id: string;
    name: string;
    code: string;
    total_results: string;
    avg_marks: string | null;
    avg_gpa: string | null;
    pass_percentage: string;
  }>;
  gradeDistribution: Array<{
    grade: string;
    count: string;
  }>;
  aiMetrics: {
    total_queries: string;
    successful_queries: string;
    fallback_queries: string;
    avg_response_ms: string | null;
  };
};

function Analytics() {
  const { me, loading: meLoading } = useMe();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-analytics"],
    enabled: !!me?.isAdmin,
    queryFn: () => api<AnalyticsData>("/admin/analytics"),
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

  const attendanceRate = parseFloat(data?.attendance?.overall_rate || "100");
  const totalQueries = parseInt(data?.aiMetrics?.total_queries || "0", 10);
  const successfulQueries = parseInt(data?.aiMetrics?.successful_queries || "0", 10);
  const aiGroundedRate = totalQueries > 0
    ? Math.round((successfulQueries / totalQueries) * 100)
    : 100;

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
        <p className="truncate text-center font-semibold">Analytics & Reports</p>
        <span className="h-11 w-11" />
      </header>

      {isLoading && (
        <p className="surface mt-6 rounded-2xl p-4 text-center text-sm text-muted-foreground">
          Aggregating campus analytics…
        </p>
      )}

      {error && (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
          Failed to load institutional analytics.
        </div>
      )}

      {data && (
        <div className="mt-6 space-y-6">
          {/* High-level KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="surface rounded-[22px] p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <CalendarCheck className="h-4 w-4 text-emerald-500" />
                Attendance
              </div>
              <p className="mt-2 text-2xl font-bold">{data.attendance.overall_rate}%</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {data.attendance.present_records} / {data.attendance.total_records} marked present
              </p>
            </div>

            <div className="surface rounded-[22px] p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Award className="h-4 w-4 text-amber-500" />
                Campus CGPA
              </div>
              <p className="mt-2 text-2xl font-bold">{data.overview.avg_cgpa || "—"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Avg Marks: {data.overview.avg_marks ? `${data.overview.avg_marks}/100` : "—"}
              </p>
            </div>

            <div className="surface rounded-[22px] p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Users className="h-4 w-4 text-sky-500" />
                Enrolled
              </div>
              <p className="mt-2 text-2xl font-bold">{data.overview.student_count}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {data.overview.faculty_count} faculty · {data.overview.class_count} classes
              </p>
            </div>

            <div className="surface rounded-[22px] p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                AI Grounding
              </div>
              <p className="mt-2 text-2xl font-bold">{aiGroundedRate}%</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {totalQueries} queries · {data.aiMetrics.avg_response_ms || "0"}ms avg
              </p>
            </div>
          </div>

          {/* At-Risk Students Warning Panel */}
          <div>
            <SectionTitle>
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                At-Risk Students ({data.atRiskStudents.length})
              </span>
            </SectionTitle>
            <div className="surface mt-2 divide-y divide-border rounded-[22px] overflow-hidden">
              {data.atRiskStudents.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No students currently flagged below attendance (75%) or grade thresholds.
                </div>
              ) : (
                data.atRiskStudents.map((st) => {
                  const attRate = parseFloat(st.attendance_percentage);
                  const isLowAttendance = attRate < 75;
                  const isLowGrade = st.cgpa && parseFloat(st.cgpa) < 5.0;

                  return (
                    <div key={st.student_id} className="flex items-center justify-between p-4 text-xs">
                      <div className="min-w-0 pr-3">
                        <p className="font-semibold text-foreground">{st.full_name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {st.roll_number || "No PRN"} · {st.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <div>
                          <p
                            className={`font-semibold ${
                              isLowAttendance ? "text-red-500" : "text-foreground"
                            }`}
                          >
                            {st.attendance_percentage}%
                          </p>
                          <p className="text-[10px] text-muted-foreground">Attendance</p>
                        </div>
                        {st.cgpa && (
                          <div>
                            <p
                              className={`font-semibold ${
                                isLowGrade ? "text-amber-500" : "text-foreground"
                              }`}
                            >
                              {st.cgpa}
                            </p>
                            <p className="text-[10px] text-muted-foreground">CGPA</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Subject Performance Breakdown */}
          <div>
            <SectionTitle>
              <span className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                Subject Performance
              </span>
            </SectionTitle>
            <div className="surface mt-2 divide-y divide-border rounded-[22px] overflow-hidden">
              {data.subjectPerformance.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No academic subjects found.
                </div>
              ) : (
                data.subjectPerformance.map((sub) => (
                  <div key={sub.id} className="flex items-center justify-between p-4 text-xs">
                    <div>
                      <p className="font-semibold text-foreground">{sub.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {sub.code} · {sub.total_results} graded results
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <p className="font-semibold text-foreground">
                          {sub.avg_marks ? `${sub.avg_marks}/100` : "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">Avg Marks</p>
                      </div>
                      <div>
                        <p className="font-semibold text-emerald-500">{sub.pass_percentage}%</p>
                        <p className="text-[10px] text-muted-foreground">Pass Rate</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Grade Distribution */}
          {data.gradeDistribution.length > 0 && (
            <div>
              <SectionTitle>
                <span className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Grade Distribution
                </span>
              </SectionTitle>
              <div className="surface mt-2 rounded-[22px] p-4">
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                  {data.gradeDistribution.map((item) => (
                    <div
                      key={item.grade}
                      className="rounded-xl border border-border bg-card p-2 text-center"
                    >
                      <p className="text-xs font-semibold text-primary">{item.grade}</p>
                      <p className="mt-1 text-base font-bold">{item.count}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Attendance Audit Summary */}
          <div>
            <SectionTitle>
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Audit Trail Telemetry
              </span>
            </SectionTitle>
            <div className="surface mt-2 grid grid-cols-2 gap-3 rounded-[22px] p-4 text-xs sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Total Sessions</p>
                <p className="mt-1 text-lg font-semibold">{data.attendance.total_records}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Corrections Applied</p>
                <p className="mt-1 text-lg font-semibold text-amber-500">
                  {data.attendance.corrected_records}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Absent Records</p>
                <p className="mt-1 text-lg font-semibold text-red-500">
                  {data.attendance.absent_records}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
