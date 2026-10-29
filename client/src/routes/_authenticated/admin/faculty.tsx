import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Check, X, Search } from "lucide-react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/admin/faculty")({
  head: () => ({
    meta: [
      { title: "Faculty Management — Admin" },
      { property: "og:title", content: "Faculty Management — Admin" },
    ],
  }),
  component: FacultyManagement,
});

type Faculty = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  created_at: string;
};

function FacultyManagement() {
  const { me, loading: meLoading } = useMe();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState("");

  const faculty = useQuery({
    queryKey: ["admin-faculty"],
    enabled: !!me?.isAdmin,
    queryFn: async () => {
      const { users } = await api<{ users: Faculty[] }>("/admin/users");
      return users.filter((u) => u.role === "faculty");
    },
  });

  const handleReview = async (id: string, approve: boolean) => {
    setUpdating(id);
    try {
      await api(`/admin/users/${id}`, {
        method: "PATCH",
        body: { isActive: approve },
      });
      await qc.invalidateQueries({ queryKey: ["admin-faculty"] });
    } catch (err: any) {
      alert(err.message || "Failed to update faculty status");
    } finally {
      setUpdating("");
    }
  };

  const filteredFaculty =
    faculty.data?.filter(
      (f) =>
        f.full_name.toLowerCase().includes(search.toLowerCase()) ||
        f.email.toLowerCase().includes(search.toLowerCase())
    ) || [];

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
        <p className="truncate text-center font-semibold">Faculty Management</p>
        <span className="h-11 w-11" />
      </header>

      {/* Search */}
      <div className="mt-6">
        <div className="surface flex items-center gap-3 rounded-2xl px-4 py-3">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search faculty by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <SectionTitle>Faculty Accounts ({filteredFaculty.length})</SectionTitle>
      <div className="space-y-3">
        {faculty.isLoading && (
          <p className="surface rounded-[22px] p-4 text-sm text-muted-foreground">
            Loading faculty…
          </p>
        )}
        {filteredFaculty.length === 0 && !faculty.isLoading && (
          <p className="surface rounded-[22px] p-4 text-sm text-muted-foreground">
            No faculty accounts found.
          </p>
        )}
        {filteredFaculty.map((f) => (
          <div key={f.id} className="surface rounded-[22px] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{f.full_name}</p>
                <p className="text-xs text-muted-foreground">{f.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Joined {new Date(f.created_at).toLocaleDateString()}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  f.is_active
                    ? "bg-accent text-accent-foreground"
                    : "bg-peach text-destructive"
                }`}
              >
                {f.is_active ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {!f.is_active && (
                <button
                  onClick={() => handleReview(f.id, true)}
                  disabled={updating === f.id}
                  className="press flex items-center justify-center gap-1.5 rounded-2xl bg-ai py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {updating === f.id ? (
                    "Updating…"
                  ) : (
                    <>
                      <Check className="h-4 w-4" /> Activate
                    </>
                  )}
                </button>
              )}
              {f.is_active && (
                <button
                  onClick={() => handleReview(f.id, false)}
                  disabled={updating === f.id}
                  className="press flex items-center justify-center gap-1.5 rounded-2xl border border-border bg-card py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  {updating === f.id ? (
                    "Updating…"
                  ) : (
                    <>
                      <X className="h-4 w-4" /> Deactivate
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
