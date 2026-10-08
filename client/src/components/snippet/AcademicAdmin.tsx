import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SectionTitle } from "./AppShell";
import { api } from "@/lib/api";

export function AcademicAdmin() {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const hierarchy = useQuery({
    queryKey: ["academic-hierarchy"],
    queryFn: async () => {
      const res = await api<any>("/academic/hierarchy");
      return res;
    },
  });

  const users = useQuery({
    queryKey: ["admin-users-all"],
    queryFn: async () => {
      const res = await api<{ users: any[] }>("/admin/users");
      return res.users.filter(u => u.role === 'student');
    },
  });

  const assignStudent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const studentId = formData.get("studentId") as string;
    const academicClassId = formData.get("classId") as string;
    
    if (!studentId || !academicClassId) return;
    
    setLoading(true); setErr("");
    try {
      await api(`/admin/users/${studentId}/class`, { 
        method: 'PATCH', 
        body: { academicClassId } 
      });
      qc.invalidateQueries({ queryKey: ["admin-users-all"] });
      alert("Student assigned to class successfully!");
      e.currentTarget.reset();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const createEntity = async (type: string, data: any) => {
    setLoading(true); setErr("");
    try {
      await api(`/academic/${type}`, {
        method: 'POST',
        body: data
      });
      qc.invalidateQueries({ queryKey: ["academic-hierarchy"] });
    } catch(e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SectionTitle>Academic Management</SectionTitle>
      
      {err && <p className="mt-3 text-xs text-destructive">{err}</p>}

      <div className="surface mt-4 rounded-[22px] p-5">
        <h3 className="font-semibold mb-3">Create Academic Entity</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <button disabled={loading} onClick={() => {
            const name = prompt("Branch name (e.g. Computer Science)?");
            const code = prompt("Branch code (e.g. CSE)?");
            if (name && code) createEntity("branches", { name, code });
          }} className="press rounded-xl bg-card border border-border p-2">Add Branch</button>
          
          <button disabled={loading} onClick={() => {
            const startYear = prompt("Start year (e.g. 2024)?");
            const endYear = prompt("End year (e.g. 2028)?");
            if (startYear && endYear) createEntity("batches", { startYear: parseInt(startYear), endYear: parseInt(endYear) });
          }} className="press rounded-xl bg-card border border-border p-2">Add Batch</button>
          
          <button disabled={loading} onClick={() => {
            const name = prompt("Division name (e.g. A, B)?");
            if (name) createEntity("divisions", { name });
          }} className="press rounded-xl bg-card border border-border p-2">Add Division</button>
          
          <button disabled={loading} onClick={() => {
            const number = prompt("Semester number (e.g. 1)?");
            if (number) createEntity("semesters", { number: parseInt(number) });
          }} className="press rounded-xl bg-card border border-border p-2">Add Semester</button>
        </div>
      </div>

      <div className="surface mt-4 rounded-[22px] p-5">
        <h3 className="font-semibold mb-3">Create Academic Class</h3>
        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          createEntity("classes", {
            branchId: fd.get("branchId"),
            batchId: fd.get("batchId"),
            divisionId: fd.get("divisionId"),
            semesterId: fd.get("semesterId")
          });
        }} className="flex flex-col gap-3 text-sm">
          <select name="branchId" required className="rounded-xl border border-border bg-card p-2 outline-none">
            <option value="">Select Branch</option>
            {hierarchy.data?.branches?.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select name="batchId" required className="rounded-xl border border-border bg-card p-2 outline-none">
            <option value="">Select Batch</option>
            {hierarchy.data?.batches?.map((b: any) => <option key={b.id} value={b.id}>{b.start_year}-{b.end_year}</option>)}
          </select>
          <select name="divisionId" required className="rounded-xl border border-border bg-card p-2 outline-none">
            <option value="">Select Division</option>
            {hierarchy.data?.divisions?.map((d: any) => <option key={d.id} value={d.id}>Div {d.name}</option>)}
          </select>
          <select name="semesterId" required className="rounded-xl border border-border bg-card p-2 outline-none">
            <option value="">Select Semester</option>
            {hierarchy.data?.semesters?.map((s: any) => <option key={s.id} value={s.id}>Sem {s.number}</option>)}
          </select>
          <button disabled={loading} type="submit" className="press rounded-xl bg-primary text-primary-foreground py-2 font-medium">Create Class</button>
        </form>
      </div>

      <div className="surface mt-4 rounded-[22px] p-5">
        <h3 className="font-semibold mb-3">Assign Student to Class</h3>
        <form onSubmit={assignStudent} className="flex flex-col gap-3 text-sm">
          <select name="studentId" required className="rounded-xl border border-border bg-card p-2 outline-none">
            <option value="">Select Student</option>
            {users.data?.map((u: any) => (
              <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
            ))}
          </select>
          <select name="classId" required className="rounded-xl border border-border bg-card p-2 outline-none">
            <option value="">Select Class</option>
            {hierarchy.data?.classes?.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.branch_code} | {c.start_year}-{c.end_year} | Div {c.division_name} | Sem {c.semester_number}
              </option>
            ))}
          </select>
          <button disabled={loading} type="submit" className="press rounded-xl bg-ai text-primary-foreground py-2 font-medium">Assign Student</button>
        </form>
      </div>
      <div className="surface mt-4 rounded-[22px] p-5">
        <h3 className="font-semibold mb-3">Create Subject</h3>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setLoading(true); setErr("");
          try {
            await api("/subjects", {
              method: 'POST',
              body: {
                name: fd.get("name"),
                code: fd.get("code"),
                description: fd.get("description"),
                credits: parseInt(fd.get("credits") as string)
              }
            });
            qc.invalidateQueries({ queryKey: ["academic-hierarchy"] });
            alert("Subject created successfully!");
            e.currentTarget.reset();
          } catch(err: any) {
            setErr(err.message);
          } finally {
            setLoading(false);
          }
        }} className="flex flex-col gap-3 text-sm">
          <input name="name" required placeholder="Subject Name (e.g. Database Systems)" className="rounded-xl border border-border bg-card p-2 outline-none" />
          <input name="code" required placeholder="Subject Code (e.g. CS301)" className="rounded-xl border border-border bg-card p-2 outline-none" />
          <input name="description" placeholder="Description" className="rounded-xl border border-border bg-card p-2 outline-none" />
          <input name="credits" type="number" required placeholder="Credits (e.g. 3)" className="rounded-xl border border-border bg-card p-2 outline-none" />
          <button disabled={loading} type="submit" className="press rounded-xl bg-primary text-primary-foreground py-2 font-medium">Create Subject</button>
        </form>
      </div>

      <div className="surface mt-4 rounded-[22px] p-5">
        <h3 className="font-semibold mb-3">Assign Subject to Class (Create Offering)</h3>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setLoading(true); setErr("");
          try {
            await api("/subjects/offerings", {
              method: 'POST',
              body: {
                subjectId: fd.get("subjectId"),
                academicClassId: fd.get("academicClassId"),
                facultyId: fd.get("facultyId")
              }
            });
            alert("Subject assigned to class successfully!");
            e.currentTarget.reset();
          } catch(err: any) {
            setErr(err.message);
          } finally {
            setLoading(false);
          }
        }} className="flex flex-col gap-3 text-sm">
          <select name="subjectId" required className="rounded-xl border border-border bg-card p-2 outline-none">
            <option value="">Select Subject</option>
            {hierarchy.data?.subjects?.map((s: any) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
          <select name="academicClassId" required className="rounded-xl border border-border bg-card p-2 outline-none">
            <option value="">Select Class</option>
            {hierarchy.data?.classes?.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.branch_code} | {c.start_year}-{c.end_year} | Div {c.division_name} | Sem {c.semester_number}
              </option>
            ))}
          </select>
          <select name="facultyId" required className="rounded-xl border border-border bg-card p-2 outline-none">
            <option value="">Select Faculty</option>
            {/* Using a separate query or existing users query. Since users query fetches only students right now, let's just make it fetch faculty or we can let admin type ID. Wait, let's fix the users query to get all or create a faculty query */}
            {hierarchy.data?.faculty?.map((f: any) => (
              <option key={f.id} value={f.id}>{f.full_name} ({f.email})</option>
            ))}
          </select>
          <button disabled={loading} type="submit" className="press rounded-xl bg-ai text-primary-foreground py-2 font-medium">Assign Subject to Class</button>
        </form>
      </div>
    </>
  );
}
