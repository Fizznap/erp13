import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, X } from "lucide-react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { AcademicAdmin } from "@/components/snippet/AcademicAdmin";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Snippet" },
      { name: "description", content: "Approve or reject faculty access requests." },
    ],
  }),
  component: Admin,
});

function Admin() {
  const { me, loading } = useMe();
  const qc = useQueryClient();
  const reqs = useQuery({
    queryKey: ["admin-users"],
    enabled: !!me?.isAdmin,
    queryFn: async () => { 
      const { users } = await api<{ users: any[] }>("/admin/users"); 
      return users.filter(u => u.role === 'faculty'); // Show faculty
    },
  });
  const review = async (id: string, approve: boolean) => {
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body: { isActive: approve } });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <AppShell>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Link to="/" aria-label="Back" className="glass press grid h-11 w-11 place-items-center rounded-full"><ArrowLeft className="h-5 w-5" /></Link>
        <p className="truncate text-center font-semibold">Admin</p>
        <span className="h-11 w-11" />
      </header>
      {loading ? <p className="mt-6 text-sm text-muted-foreground">Loading…</p> : !me?.isAdmin ? (
        <p className="surface mt-6 rounded-[22px] p-4 text-sm text-muted-foreground">Only admins can view this page.</p>
      ) : (
        <>
          <SectionTitle>Faculty Accounts</SectionTitle>
          <div className="space-y-3">
            {reqs.data?.length === 0 && <p className="surface rounded-[22px] p-4 text-sm text-muted-foreground">No faculty accounts.</p>}
            {reqs.data?.map((r) => (
              <div key={r.id} className="surface rounded-[22px] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${r.is_active ? "bg-accent text-accent-foreground" : "bg-peach text-destructive"}`}>{r.is_active ? "Active" : "Inactive"}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {!r.is_active && <button onClick={() => review(r.id, true)} className="press flex items-center justify-center gap-1.5 rounded-2xl bg-ai py-2.5 text-sm font-semibold text-primary-foreground"><Check className="h-4 w-4" /> Activate</button>}
                  {r.is_active && <button onClick={() => review(r.id, false)} className="press flex items-center justify-center gap-1.5 rounded-2xl border border-border bg-card py-2.5 text-sm font-semibold"><X className="h-4 w-4" /> Deactivate</button>}
                </div>
              </div>
            ))}
          </div>
          <AcademicAdmin />
        </>
      )}
    </AppShell>
  );
}
