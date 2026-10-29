import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Search, UserPlus } from "lucide-react";
import { AppShell, SectionTitle } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/admin/students")({
  head: () => ({
    meta: [
      { title: "Student Management — Admin" },
      { property: "og:title", content: "Student Management — Admin" },
    ],
  }),
  component: StudentManagement,
});

type Student = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  academic_class_id: string | null;
  profile?: {
    roll_number?: string;
    college_id?: string;
    year_of_study?: number;
  };
};

type AcademicClass = {
  id: string;
  branch_code: string;
  start_year: number;
  end_year: number;
  division_name: string;
  semester_number: number;
};

type LabGroup = {
  id: string;
  name: string;
  branch_id: string;
  batch_id: string;
  division_id: string;
};

function StudentManagement() {
  const { me, loading: meLoading } = useMe();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedLabGroupId, setSelectedLabGroupId] = useState("");
  const [assigningStudent, setAssigningStudent] = useState<string | null>(null);
  const [error, setError] = useState("");

  const students = useQuery({
    queryKey: ["admin-students"],
    enabled: !!me?.isAdmin,
    queryFn: async () => {
      const { users } = await api<{ users: Student[] }>("/admin/users");
      return users.filter((u) => u.role === "student");
    },
  });

  const hierarchy = useQuery({
    queryKey: ["academic-hierarchy"],
    enabled: !!me?.isAdmin,
    queryFn: async () => {
      const data = await api<{
        classes: AcademicClass[];
        labGroups: LabGroup[];
      }>("/academic/hierarchy");
      return data;
    },
  });

  const handleAssignClass = async (studentId: string) => {
    if (!selectedClassId || !selectedLabGroupId) {
      setError("Please select both a class and a lab group");
      return;
    }

    setAssigningStudent(studentId);
    setError("");
    try {
      await api(`/admin/users/${studentId}/class`, {
        method: "PATCH",
        body: {
          academicClassId: selectedClassId,
          academicLabGroupId: selectedLabGroupId,
        },
      });
      await qc.invalidateQueries({ queryKey: ["admin-students"] });
      setSelectedClassId("");
      setSelectedLabGroupId("");
      alert("Student assigned successfully!");
    } catch (err: any) {
      setError(err.message || "Failed to assign student");
    } finally {
      setAssigningStudent(null);
    }
  };

  const filteredStudents =
    students.data?.filter(
      (s) =>
        s.full_name.toLowerCase().includes(search.toLowerCase()) ||
        s.email.toLowerCase().includes(search.toLowerCase()) ||
        s.profile?.roll_number?.toLowerCase().includes(search.toLowerCase())
    ) || [];

  const selectedClass = hierarchy.data?.classes.find(
    (c) => c.id === selectedClassId
  );
  const availableLabGroups = hierarchy.data?.labGroups.filter(
    (g) =>
      selectedClass &&
      g.branch_id === (selectedClass as any).branch_id &&
      g.batch_id === (selectedClass as any).batch_id &&
      g.division_id === (selectedClass as any).division_id
  );

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
        <p className="truncate text-center font-semibold">Student Management</p>
        <span className="h-11 w-11" />
      </header>

      {error && (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="mt-6">
        <div className="surface flex items-center gap-3 rounded-2xl px-4 py-3">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search students by name, email, or roll number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Class Assignment Form */}
      <SectionTitle>Assign Students to Classes</SectionTitle>
      <div className="surface rounded-[22px] p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Academic Class
          </label>
          <select
            value={selectedClassId}
            onChange={(e) => {
              setSelectedClassId(e.target.value);
              setSelectedLabGroupId("");
            }}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none"
          >
            <option value="">Select Class</option>
            {hierarchy.data?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.branch_code} | {c.start_year}-{c.end_year} | Div{" "}
                {c.division_name} | Sem {c.semester_number}
              </option>
            ))}
          </select>
        </div>

        {selectedClassId && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Lab Group
            </label>
            <select
              value={selectedLabGroupId}
              onChange={(e) => setSelectedLabGroupId(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none"
            >
              <option value="">Select Lab Group</option>
              {availableLabGroups?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Select a class and lab group, then click the assign button next to a
          student below.
        </p>
      </div>

      {/* Student List */}
      <SectionTitle>All Students ({filteredStudents.length})</SectionTitle>
      <div className="space-y-2">
        {students.isLoading && (
          <p className="surface rounded-2xl p-4 text-sm text-muted-foreground">
            Loading students…
          </p>
        )}
        {filteredStudents.length === 0 && !students.isLoading && (
          <p className="surface rounded-2xl p-4 text-sm text-muted-foreground">
            No students found.
          </p>
        )}
        {filteredStudents.map((student) => (
          <div key={student.id} className="surface rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{student.full_name}</p>
                <p className="text-xs text-muted-foreground">{student.email}</p>
                {student.profile?.roll_number && (
                  <p className="mt-1 text-xs">
                    Roll: {student.profile.roll_number}
                  </p>
                )}
                {student.academic_class_id ? (
                  <span className="mt-2 inline-block rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
                    Class Assigned
                  </span>
                ) : (
                  <span className="mt-2 inline-block rounded-full bg-peach px-2 py-0.5 text-xs font-semibold text-destructive">
                    No Class
                  </span>
                )}
              </div>
              <button
                onClick={() => handleAssignClass(student.id)}
                disabled={
                  assigningStudent === student.id ||
                  !selectedClassId ||
                  !selectedLabGroupId
                }
                className="press shrink-0 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {assigningStudent === student.id ? (
                  "Assigning..."
                ) : (
                  <>
                    <UserPlus className="inline h-3.5 w-3.5" /> Assign
                  </>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
