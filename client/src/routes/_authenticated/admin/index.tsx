import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Users,
  GraduationCap,
  BookOpen,
  Calendar,
  ClipboardCheck,
  BarChart3,
  FileText,
  Settings,
  ChevronRight,
} from "lucide-react";
import { AppShell } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — Snippet" },
      { property: "og:title", content: "Admin Dashboard — Snippet" },
      {
        property: "og:description",
        content: "Manage students, faculty, academics, attendance, and results.",
      },
      {
        name: "description",
        content: "Campus ERP administration dashboard.",
      },
    ],
  }),
  component: AdminDashboard,
});

type AdminStats = {
  users: Array<{ role: string; count: string }>;
  subjects: number;
  resources: Array<{ status: string; count: string }>;
  queries: {
    total_queries: string;
    found_count: string;
    not_found_count: string;
    avg_latency_ms: string;
  };
};

function AdminDashboard() {
  const { me, loading } = useMe();

  const stats = useQuery({
    queryKey: ["admin-stats"],
    enabled: !!me?.isAdmin,
    queryFn: async () => {
      const data = await api<AdminStats>("/admin/stats");
      return data;
    },
  });

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
        <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <Link
            to="/"
            aria-label="Back"
            className="glass press grid h-11 w-11 place-items-center rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <p className="truncate text-center font-semibold">Admin</p>
          <span className="h-11 w-11" />
        </header>
        <p className="surface mt-6 rounded-[22px] p-4 text-sm text-muted-foreground">
          Only administrators can access this area.
        </p>
      </AppShell>
    );
  }

  const studentCount =
    stats.data?.users.find((u) => u.role === "student")?.count || "0";
  const facultyCount =
    stats.data?.users.find((u) => u.role === "faculty")?.count || "0";
  const resourceCount = stats.data?.resources
    .filter((r) => r.status === "ready")
    .reduce((sum, r) => sum + parseInt(r.count || "0"), 0);

  const adminSections = [
    {
      title: "Student Management",
      icon: Users,
      description: "Manage student accounts and class assignments",
      href: "/admin/students",
      badge: studentCount,
    },
    {
      title: "Faculty Accounts",
      icon: GraduationCap,
      description: "Activate and manage faculty members",
      href: "/admin/faculty",
      badge: facultyCount,
    },
    {
      title: "Academic Structure",
      icon: BookOpen,
      description: "Branches, batches, divisions, semesters, and classes",
      href: "/admin/academic",
      badge: null,
    },
    {
      title: "Subjects & Offerings",
      icon: Calendar,
      description: "Create subjects and assign to classes",
      href: "/admin/subjects",
      badge: stats.data?.subjects.toString() || "0",
    },
    {
      title: "Attendance Management",
      icon: ClipboardCheck,
      description: "View and edit attendance records",
      href: "/admin/attendance",
      badge: null,
    },
    {
      title: "Academic Results",
      icon: FileText,
      description: "Manage student grades and SGPA",
      href: "/admin/results",
      badge: null,
    },
    {
      title: "Analytics & Reports",
      icon: BarChart3,
      description: "Student performance and attendance insights",
      href: "/admin/analytics",
      badge: null,
    },
    {
      title: "System Settings",
      icon: Settings,
      description: "Platform configuration and logs",
      href: "/admin/settings",
      badge: null,
    },
  ];

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
        <p className="truncate text-center font-semibold">Admin Dashboard</p>
        <span className="h-11 w-11" />
      </header>

      {/* Quick Stats */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <div className="surface rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold">{studentCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">Students</p>
        </div>
        <div className="surface rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold">{facultyCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">Faculty</p>
        </div>
        <div className="surface rounded-2xl p-4 text-center">
          <p className="text-2xl font-bold">{resourceCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">Resources</p>
        </div>
      </div>

      {/* Admin Sections */}
      <div className="mt-6 space-y-3">
        {adminSections.map((section) => (
          <Link
            key={section.href}
            to={section.href}
            className="surface press flex items-center gap-4 rounded-[22px] p-4 hover:bg-accent/50"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
              <section.icon className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold">{section.title}</p>
                {section.badge && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
                    {section.badge}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {section.description}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
