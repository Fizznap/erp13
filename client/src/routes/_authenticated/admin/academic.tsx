import { createFileRoute, Link } from "@tanstack/react-router";
import { AcademicAdmin } from "@/components/snippet/AcademicAdmin";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin/academic")({
  head: () => ({
    meta: [
      { title: "Academic Structure — Admin" },
      { property: "og:title", content: "Academic Structure — Admin" },
    ],
  }),
  component: AcademicStructure,
});

function AcademicStructure() {
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
        <p className="truncate text-center font-semibold">Academic Structure</p>
        <span className="h-11 w-11" />
      </header>

      <AcademicAdmin />
    </AppShell>
  );
}
