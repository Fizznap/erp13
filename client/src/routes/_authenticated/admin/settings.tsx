import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({
    meta: [
      { title: "System Settings — Admin" },
      { property: "og:title", content: "System Settings — Admin" },
    ],
  }),
  component: Settings,
});

function Settings() {
  const { me, loading: meLoading } = useMe();

  const stats = useQuery({
    queryKey: ["admin-stats"],
    enabled: !!me?.isAdmin,
    queryFn: async () => {
      const data = await api<any>("/admin/stats");
      return data;
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
        <p className="truncate text-center font-semibold">System Settings</p>
        <span className="h-11 w-11" />
      </header>

      <SectionTitle>Platform Statistics</SectionTitle>
      {stats.data && (
        <div className="surface rounded-2xl p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Queries:</span>
            <span className="font-semibold">
              {stats.data.queries?.total_queries || 0}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Found Rate:</span>
            <span className="font-semibold">
              {stats.data.queries?.found_count || 0} /{" "}
              {stats.data.queries?.total_queries || 0}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Avg Latency:</span>
            <span className="font-semibold">
              {stats.data.queries?.avg_latency_ms || 0}ms
            </span>
          </div>
        </div>
      )}

      <SectionTitle>AI Query Logs</SectionTitle>
      <p className="surface rounded-2xl p-4 text-sm text-muted-foreground">
        Detailed AI query logs and audit trail available through existing /admin/logs endpoint.
        UI integration in progress.
      </p>
    </AppShell>
  );
}
