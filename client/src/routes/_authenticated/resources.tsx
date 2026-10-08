import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, FileText, Presentation, NotebookPen, File, Trash2, Upload, Download } from "lucide-react";
import { useRef, useState } from "react";
import { AppShell } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/resources")({
  head: () => ({
    meta: [
      { title: "Resources — Snippet" },
      { name: "description", content: "Notes, slides and PDFs for every subject, uploaded by your faculty." },
      { property: "og:title", content: "Resources — Snippet" },
      { property: "og:description", content: "Course resources by subject." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Resources,
});

const KINDS = ["Notes", "Slides", "PDFs", "Other"] as const;
const look = {
  Notes: { icon: NotebookPen, tint: "bg-mint" },
  Slides: { icon: Presentation, tint: "bg-lavender" },
  PDFs: { icon: FileText, tint: "bg-peach" },
  Other: { icon: File, tint: "bg-sky" },
} as const;
const mb = (b?: number | null) => (b ? `${(b / 1024 / 1024).toFixed(1)} MB` : "");

function Resources() {
  const { me } = useMe();
  const [f, setF] = useState("All");
  const [q, setQ] = useState("");
  const [subjectId, setSubjectId] = useState<string>("");

  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { subjects } = await api<{ subjects: any[] }>("/subjects");
      if (subjects.length > 0 && !subjectId) {
        setSubjectId(String(subjects[0].id));
      }
      return subjects;
    },
  });

  const list = useQuery({
    queryKey: ["resources", subjectId],
    queryFn: async () => {
      if (!subjectId) return [];
      const { resources } = await api<{ resources: any[] }>(`/resources?subjectId=${subjectId}`);
      return resources;
    },
    enabled: !!subjectId,
  });

  const items = (list.data ?? []).filter((i) => (f === "All" || i.kind === f) && `${i.filename} ${i.original_name}`.toLowerCase().includes(q.toLowerCase()));

  const open = async (id: string) => {
    const API_BASE = (import.meta.env as any).VITE_API_URL || 'http://localhost:3001/api';
    const token = localStorage.getItem('snippet_token');
    
    // Quick hack to download using a fetch so we can pass auth headers, 
    // or just let the user login via cookies. Since we use JWT in headers, we must fetch and create an object URL.
    try {
      const res = await fetch(`${API_BASE}/resources/${id}/download`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to download");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "download"; // Should pull from res headers ideally
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert("Couldn't open this file.");
    }
  };

  return (
    <AppShell>
      <h1 className="rise text-[28px] font-semibold tracking-tight">Resources</h1>
      
      {subjectsQuery.data && subjectsQuery.data.length > 0 ? (
        <select value={subjectId} onChange={e => setSubjectId(e.target.value)} className="w-full mt-4 rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-hidden focus:border-primary">
          <option value="" disabled>Select Subject</option>
          {subjectsQuery.data.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
          ))}
        </select>
      ) : null}

      {me?.isFaculty && <UploadCard userId={me.user.id} subjects={subjectsQuery.data || []} />}
      
      <label className="glass mt-5 flex items-center gap-2 rounded-[20px] px-4 py-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title…" className="min-w-0 flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground" />
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      </label>
      <div className="mt-4 flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {["All", ...KINDS].map((x) => (
          <button key={x} onClick={() => setF(x)} className={`press shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${f === x ? "bg-foreground text-background" : "surface"}`}>{x}</button>
        ))}
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {items.map((r) => {
          const L = look[(r.kind as keyof typeof look) ?? "Other"] ?? look.Other;
          return (
            <article key={r.id} className="surface rise rounded-[24px] p-4">
              <div className="flex items-start gap-3">
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${L.tint}`}><L.icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.original_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{[r.kind, mb(r.file_size), new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })].filter(Boolean).join(" • ")}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => open(r.id)} className="press flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-foreground py-2.5 text-sm font-semibold text-background"><Download className="h-4 w-4" /> Open</button>
                {/* Note: In our system uploaded_by is ID, we don't return it in list sometimes. Assuming we can delete if faculty */}
                {me?.isFaculty && <DeleteBtn id={r.id} />}
              </div>
            </article>
          );
        })}
        {!list.isLoading && items.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground md:col-span-2">{list.data?.length ? "No resources match." : "No resources yet. Your faculty's uploads will show here."}</p>}
      </div>
    </AppShell>
  );
}

function DeleteBtn({ id }: { id: string }) {
  const qc = useQueryClient();
  return (
    <button aria-label="Delete" onClick={async () => {
      if (!confirm("Delete this resource?")) return;
      try {
        await api(`/resources/${id}`, { method: 'DELETE' });
        qc.invalidateQueries({ queryKey: ["resources"] });
      } catch (err) {
        alert("Failed to delete.");
      }
    }} className="press grid w-11 place-items-center rounded-2xl border border-border bg-card text-muted-foreground"><Trash2 className="h-4 w-4" /></button>
  );
}

function UploadCard({ userId, subjects }: { userId: string, subjects: any[] }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [subjectId, setSubjectId] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("Notes"); // Not stored in backend currently, but we can pass it if schema supports
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !subjectId) return;
    if (file.size > 20 * 1024 * 1024) return setMsg({ ok: false, t: "File must be under 20 MB." });
    setBusy(true); setMsg(null);
    
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("subjectId", subjectId);
      fd.append("kind", kind);

      await api('/resources/upload', {
        method: 'POST',
        body: fd
      });

      setMsg({ ok: true, t: "Uploaded!" }); 
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["resources"] });
    } catch (err: any) {
      setMsg({ ok: false, t: err.message || "Failed to upload" });
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-hidden focus:border-primary";
  return (
    <form onSubmit={submit} className="surface mt-5 space-y-3 rounded-[24px] p-4">
      <p className="flex items-center gap-2 font-semibold"><Upload className="h-4 w-4" /> Upload a resource</p>
      <select required value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={input}>
        <option value="">Choose subject</option>
        {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
      </select>
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {KINDS.map((k) => <button type="button" key={k} onClick={() => setKind(k)} className={`press shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${kind === k ? "bg-foreground text-background" : "border border-border bg-card"}`}>{k}</button>)}
      </div>
      <input ref={fileRef} required accept="application/pdf" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium" />
      {msg && <p className={`text-xs ${msg.ok ? "text-primary-deep" : "text-destructive"}`}>{msg.t}</p>}
      <button disabled={busy || !file || !subjectId} className="press w-full rounded-2xl bg-ai py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? "Uploading…" : "Upload"}</button>
    </form>
  );
}
