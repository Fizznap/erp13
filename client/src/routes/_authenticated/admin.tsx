import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useMe } from "@/hooks/use-auth";
import { AppShell } from "@/components/snippet/AppShell";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Snippet" },
      { property: "og:title", content: "Admin — Snippet" },
      { property: "og:description", content: "Manage students, faculty, academics, attendance, and results." },
      { name: "description", content: "Campus ERP administration dashboard." },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const { me, loading } = useMe();

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
          Only administrators can access this area.
        </p>
      </AppShell>
    );
  }

  return <Outlet />;
}
