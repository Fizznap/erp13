import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Check, X, Search, Plus, UserPlus, AlertCircle, BookOpen } from "lucide-react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api, fetchSubjects, SUBJECTS_QUERY_KEY, Subject } from "@/lib/api";

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

export function FacultyManagement() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = Boolean(me?.isAdmin || me?.role === "admin");
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  // New faculty form states
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formDepartment, setFormDepartment] = useState("Computer Science & Engineering");
  const [formOfferingId, setFormOfferingId] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [bannerSuccess, setBannerSuccess] = useState("");

  const faculty = useQuery({
    queryKey: ["admin-faculty"],
    enabled: isAdmin,
    queryFn: async () => {
      const { users } = await api<{ users: Faculty[] }>("/admin/users");
      return users.filter((u) => u.role === "faculty");
    },
  });

  const subjects = useQuery({
    queryKey: SUBJECTS_QUERY_KEY,
    queryFn: fetchSubjects,
  });

  const handleCreateFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setBannerSuccess("");

    if (!formName.trim() || !formEmail.trim() || !formPassword.trim()) {
      setFormError("All required fields must be filled");
      return;
    }

    if (formPassword.length < 6) {
      setFormError("Password must be at least 6 characters");
      return;
    }

    setFormSubmitting(true);
    try {
      const res = await api<{ message: string; faculty: Faculty }>("/admin/faculty", {
        method: "POST",
        body: {
          fullName: formName.trim(),
          email: formEmail.trim(),
          password: formPassword.trim(),
          department: formDepartment.trim(),
          subjectOfferingId: formOfferingId || null,
        },
      });

      await qc.invalidateQueries({ queryKey: ["admin-faculty"] });
      await qc.invalidateQueries({ queryKey: SUBJECTS_QUERY_KEY });
      setBannerSuccess(`Faculty account created for ${res.faculty.full_name} (${res.faculty.email})!`);
      setShowAddModal(false);
      setFormName("");
      setFormEmail("");
      setFormPassword("");
      setFormOfferingId("");
    } catch (err: any) {
      setFormError(err.message || "Failed to create faculty account");
    } finally {
      setFormSubmitting(false);
    }
  };

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

  if (!isAdmin) {
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
        <button
          type="button"
          aria-label="Add Faculty Member"
          onClick={() => {
            setShowAddModal(true);
            setFormError("");
          }}
          className="press flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background"
        >
          <Plus className="h-5 w-5" />
        </button>
      </header>

      {bannerSuccess && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-xs font-medium text-primary-deep">
          <Check className="h-4 w-4 shrink-0" />
          <span>{bannerSuccess}</span>
        </div>
      )}

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

      <div className="flex items-center justify-between pt-4">
        <SectionTitle>Faculty Accounts ({filteredFaculty.length})</SectionTitle>
        <button
          type="button"
          onClick={() => {
            setShowAddModal(true);
            setFormError("");
          }}
          className="press inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
        >
          <UserPlus className="h-3.5 w-3.5" /> Add Faculty
        </button>
      </div>

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

      {/* CREATE FACULTY MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="surface w-full max-w-md rounded-[28px] border border-border p-6 shadow-float">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Add Faculty Member</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="press rounded-full p-1.5 text-muted-foreground hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateFaculty} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Full Name *</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Dr. Alan Turing"
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">College Email *</label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="e.g. alan.turing@ustu.edu.in"
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Initial Password * (min 6 chars)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Department / Program</label>
                <input
                  type="text"
                  value={formDepartment}
                  onChange={(e) => setFormDepartment(e.target.value)}
                  placeholder="e.g. Computer Science & Engineering"
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">
                  Assign Subject Offering (Optional)
                </label>
                <select
                  value={formOfferingId}
                  onChange={(e) => setFormOfferingId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-hidden focus:border-primary"
                >
                  <option value="">-- No immediate subject assignment --</option>
                  {subjects.data?.map((s) => (
                    <option key={s.offering_id || s.id} value={s.offering_id || ""}>
                      {s.code} · {s.name} {s.division_name ? `(Div ${s.division_name})` : ""}
                    </option>
                  ))}
                </select>
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
                  {formSubmitting ? "Creating…" : "Create Faculty"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
