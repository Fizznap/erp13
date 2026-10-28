import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, FileText, Presentation, NotebookPen, File, Trash2, Upload, Download, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";
import { api, API_BASE, fetchSubjects, fetchResourcePdf, SUBJECTS_QUERY_KEY, type Subject } from "@/lib/api";

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
  const [offeringId, setOfferingId] = useState<string>("");

  const subjectsQuery = useQuery({
    queryKey: SUBJECTS_QUERY_KEY,
    queryFn: fetchSubjects,
  });

  useEffect(() => {
    if (!offeringId && subjectsQuery.data && subjectsQuery.data.length > 0) {
      const first = subjectsQuery.data[0];
      if (first) {
        setOfferingId(String(first.offering_id || first.id));
      }
    }
  }, [offeringId, subjectsQuery.data]);

  const selectedSubject = subjectsQuery.data?.find((subject) => String(subject.offering_id || subject.id) === offeringId);
  const list = useQuery({
    queryKey: ["resources", offeringId, selectedSubject?.offering_id],
    queryFn: async () => {
      if (!offeringId) return [];
      const parameter = selectedSubject?.offering_id
        ? `subjectOfferingId=${selectedSubject.offering_id}`
        : `subjectId=${offeringId}`;
      const { resources } = await api<{ resources: any[] }>(`/resources?${parameter}`);
      return resources;
    },
    enabled: !!offeringId,
  });

  const items = (list.data ?? []).filter((i) => (f === "All" || i.kind === f) && `${i.filename} ${i.original_name}`.toLowerCase().includes(q.toLowerCase()));

  const [actionError, setActionError] = useState<{ id?: string; message: string } | null>(null);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  // Track open preview tabs and their associated blob URLs for reliable cleanup
  const activeBlobTabsRef = useRef<Map<string, { url: string; timer?: ReturnType<typeof setInterval> }>>(new Map());

  // Cleanup all active Blob URLs when unmounting or navigating away
  useEffect(() => {
    const activeTabs = activeBlobTabsRef.current;
    const cleanupAll = () => {
      activeTabs.forEach(({ url, timer }) => {
        if (timer) clearInterval(timer);
        try {
          window.URL.revokeObjectURL(url);
        } catch (_err) {
          void _err;
        }
      });
      activeTabs.clear();
    };

    window.addEventListener("beforeunload", cleanupAll);
    return () => {
      window.removeEventListener("beforeunload", cleanupAll);
      cleanupAll();
    };
  }, []);

  const open = async (id: string) => {
    setActionError(null);
    setActiveActionId(id);

    // Open a temporary blank window synchronously during the click event to avoid popup blockers
    let popup: Window | null = null;
    try {
      popup = window.open("about:blank", "_blank");
      if (popup) {
        try {
          popup.document.title = "Opening PDF…";
        } catch {
          // Ignore potential cross-origin document access restrictions
        }
      }
    } catch {
      // Ignored: popup window opening failed
    }

    try {
      const blob = await fetchResourcePdf(id, "inline");
      const url = window.URL.createObjectURL(blob);

      let targetTab = popup;
      if (popup && !popup.closed) {
        popup.location.href = url;
      } else {
        targetTab = window.open(url, "_blank");
      }

      if (targetTab) {
        // Clear any previous preview URL for this specific resource
        const existing = activeBlobTabsRef.current.get(id);
        if (existing) {
          if (existing.timer) clearInterval(existing.timer);
          try {
            window.URL.revokeObjectURL(existing.url);
          } catch (_err) {
            void _err;
          }
          activeBlobTabsRef.current.delete(id);
        }

        // Reliable cleanup tied directly to the PDF tab being closed by the user.
        // The Blob URL is preserved as long as the tab is open (past 60s, indefinitely while reading).
        const revokeBlob = () => {
          const entry = activeBlobTabsRef.current.get(id);
          if (entry?.timer) clearInterval(entry.timer);
          try {
            window.URL.revokeObjectURL(url);
          } catch (_err) {
            void _err;
          }
          activeBlobTabsRef.current.delete(id);
        };

        const checkTimer = setInterval(() => {
          try {
            if (targetTab.closed) {
              revokeBlob();
            }
          } catch (_err) {
            void _err;
          }
        }, 1500);

        try {
          targetTab.addEventListener("pagehide", revokeBlob, { once: true });
          targetTab.addEventListener("unload", revokeBlob, { once: true });
        } catch (_err) {
          void _err;
        }

        activeBlobTabsRef.current.set(id, { url, timer: checkTimer });
      } else {
        setActionError({
          id,
          message: "Popup was blocked by your browser. Please allow popups for this site or use the download button.",
        });
        try {
          window.URL.revokeObjectURL(url);
        } catch (_err) {
          void _err;
        }
      }
    } catch (err: unknown) {
      if (popup && !popup.closed) {
        popup.close();
      }
      const message = err instanceof Error ? err.message : "Couldn't open this file.";
      setActionError({
        id,
        message,
      });
    } finally {
      setActiveActionId(null);
    }
  };

  const download = async (id: string, originalName: string) => {
    setActionError(null);
    setActiveActionId(`download-${id}`);

    try {
      const blob = await fetchResourcePdf(id, "attachment");
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const filename = originalName.toLowerCase().endsWith(".pdf") ? originalName : `${originalName}.pdf`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        try {
          window.URL.revokeObjectURL(url);
        } catch (_err) {
          void _err;
        }
      }, 10000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Couldn't download this file.";
      setActionError({
        id,
        message,
      });
    } finally {
      setActiveActionId(null);
    }
  };

  return (
    <AppShell>
      <h1 className="rise text-[28px] font-semibold tracking-tight">Resources</h1>
      
      {subjectsQuery.isLoading && (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading subjects…</p>
      )}

      {subjectsQuery.isError && (
        <p className="surface mt-4 rounded-[22px] p-4 text-sm text-destructive">
          Could not load your subjects. Please try again.
        </p>
      )}

      {!subjectsQuery.isLoading && !subjectsQuery.isError && subjectsQuery.data && subjectsQuery.data.length === 0 && (
        <div className="surface mt-4 rounded-[22px] p-5 text-sm text-muted-foreground">
          No subjects have been assigned to your class yet.
        </div>
      )}

      {!subjectsQuery.isLoading && !subjectsQuery.isError && subjectsQuery.data && subjectsQuery.data.length > 0 && (
        <select value={offeringId} onChange={e => setOfferingId(e.target.value)} className="w-full mt-4 rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-hidden focus:border-primary">
          <option value="" disabled>Select Subject</option>
          {subjectsQuery.data.map((s) => (
            <option key={s.offering_id || s.id} value={s.offering_id || s.id}>{s.name} ({s.code})</option>
          ))}
        </select>
      )}

      {!subjectsQuery.isLoading && !subjectsQuery.isError && (me?.isFaculty || me?.isAdmin) && (
        <UploadCard subjects={subjectsQuery.data ?? []} isAdmin={Boolean(me?.isAdmin)} />
      )}
      
      <label className="glass mt-5 flex items-center gap-2 rounded-[20px] px-4 py-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title…" className="min-w-0 flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground" />
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      </label>
      <div className="mt-4 flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {["All", ...KINDS].map((x) => (
          <button key={x} onClick={() => setF(x)} className={`press shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${f === x ? "bg-foreground text-background" : "surface"}`}>{x}</button>
        ))}
      </div>
      {actionError && (!actionError.id || !items.some((i) => i.id === actionError?.id)) && (
        <div className="surface mt-4 flex items-center justify-between rounded-[20px] border border-destructive/20 bg-destructive/10 p-4 text-xs font-medium text-destructive">
          <span>{actionError.message}</span>
          <button type="button" onClick={() => setActionError(null)} className="ml-2 font-bold hover:underline">Dismiss</button>
        </div>
      )}
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
              
              {(r.status === 'processing' || r.status === 'queued') && (
                <div className="mt-3 rounded-xl bg-accent p-2.5 text-xs font-medium text-muted-foreground flex items-center justify-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-ai animate-pulse" />
                  Preparing this resource for Ask Snippet...
                </div>
              )}
              
              {r.status === 'failed' && (
                <div className="mt-3 rounded-xl bg-destructive/10 p-2.5 text-xs font-medium text-destructive flex items-center justify-center gap-2">
                  Processing failed
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => open(r.id)}
                  disabled={activeActionId === r.id}
                  className="press flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-foreground py-2.5 text-sm font-semibold text-background disabled:opacity-50"
                >
                  <ExternalLink className="h-4 w-4" /> {activeActionId === r.id ? "Opening…" : "Open"}
                </button>
                <button
                  type="button"
                  title="Download PDF"
                  aria-label={`Download ${r.original_name}`}
                  onClick={() => download(r.id, r.original_name)}
                  disabled={activeActionId === `download-${r.id}`}
                  className="press grid w-11 place-items-center rounded-2xl border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                </button>
                {(me?.isFaculty || me?.isAdmin) && <DeleteBtn id={r.id} />}
              </div>
              {actionError && actionError.id === r.id && (
                <p className="mt-2 text-xs font-medium text-destructive">{actionError.message}</p>
              )}
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

function UploadCard({ subjects, isAdmin }: { subjects: Subject[]; isAdmin: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [offeringId, setOfferingId] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("Notes");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [subjectMsg, setSubjectMsg] = useState("");

  const statusQ = useQuery({
    queryKey: ["resource-status", processingId],
    queryFn: async () => {
      if (!processingId) return null;
      return api<{ status: string, stage: string, progress: number, message: string, ready: boolean, error: string | null }>(`/resources/${processingId}/status`);
    },
    enabled: !!processingId,
    refetchInterval: (q) => (q?.state?.data?.ready || q?.state?.data?.error) ? false : 2000,
  });

  useEffect(() => {
    const data = statusQ.data;
    if (data?.ready) {
      setMsg({ ok: true, t: "Ready!" });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["resources"] });
      // Clear processing state after a few seconds
      setTimeout(() => setProcessingId(null), 3000);
    } else if (data?.error) {
      setMsg({ ok: false, t: data.error || "Failed" });
      setBusy(false);
    }
  }, [statusQ.data?.ready, statusQ.data?.error, qc]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !offeringId) return;
    if (file.size > 20 * 1024 * 1024) return setMsg({ ok: false, t: "File must be under 20 MB." });
    setBusy(true); setMsg(null);
    setProcessingId(null);
    
    try {
      const fd = new FormData();
      fd.append("file", file);
      
      const selectedSubject = subjects.find(s => (s.offering_id || s.id) === offeringId);
      if (selectedSubject?.offering_id) {
        fd.append("subjectOfferingId", selectedSubject.offering_id);
      } else {
        fd.append("subjectId", offeringId);
      }
      
      fd.append("kind", kind);

      const res = await api<{ resource: { id: string } }>('/resources/upload', {
        method: 'POST',
        body: fd
      });

      setProcessingId(res.resource.id);
      setMsg({ ok: true, t: "Uploaded! Processing..." }); 
    } catch (err: any) {
      setMsg({ ok: false, t: err.message || "Failed to upload" });
      setBusy(false);
    }
  };

  const createSubject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const values = new FormData(form);
    setSubjectMsg("");
    try {
      await api("/subjects", {
        method: "POST",
        body: {
          name: values.get("name"),
          code: values.get("code"),
          description: values.get("description") || null,
        },
      });
      await qc.invalidateQueries({ queryKey: SUBJECTS_QUERY_KEY });
      form.reset();
      setSubjectMsg("Subject created. Choose it below to upload a file.");
    } catch (err: any) {
      setSubjectMsg(err.message || "Could not create subject");
    }
  };

  const isProcessing = !!processingId && !statusQ.data?.ready && !statusQ.data?.error;
  const progress = statusQ.data?.progress || (busy ? 5 : 0);
  const statusMessage = statusQ.data?.message || (busy ? "Uploading file..." : "");
  
  const input = "w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-hidden focus:border-primary disabled:opacity-50";
  return (
    <div className="surface mt-5 space-y-3 rounded-[24px] p-4">
      <p className="flex items-center gap-2 font-semibold"><Upload className="h-4 w-4" /> Upload a resource</p>
      
      {isProcessing ? (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
          <div className="flex justify-between text-sm font-medium">
            <span>{statusMessage}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-accent">
            <div className="h-full bg-ai transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <>
          {subjects.length === 0 && isAdmin && (
            <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">Create a real subject before uploading its first resource.</p>
              <form onSubmit={createSubject} className="space-y-2">
                <input name="name" required placeholder="Subject name" className={input} />
                <input name="code" required placeholder="Subject code" className={input} />
                <input name="description" placeholder="Description (optional)" className={input} />
                <button className="press w-full rounded-2xl bg-foreground py-3 text-sm font-semibold text-background">Create subject</button>
              </form>
              {subjectMsg && <p className="text-xs text-muted-foreground">{subjectMsg}</p>}
            </div>
          )}
          <form id="upload-resource-form" onSubmit={submit} className="space-y-3">
            <select required value={offeringId} onChange={(e) => setOfferingId(e.target.value)} disabled={busy || subjects.length === 0} className={input}>
            {subjects.length === 0 ? (
              <option value="">No subjects available</option>
            ) : (
              <option value="">Choose subject</option>
            )}
            {subjects.map((s) => <option key={s.offering_id || s.id} value={s.offering_id || s.id}>{s.code} · {s.name}</option>)}
          </select>
          <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {KINDS.map((k) => <button type="button" disabled={busy} key={k} onClick={() => setKind(k)} className={`press shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium disabled:opacity-50 ${kind === k ? "bg-foreground text-background" : "border border-border bg-card"}`}>{k}</button>)}
          </div>
          <input ref={fileRef} disabled={busy || subjects.length === 0} required accept="application/pdf" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium disabled:opacity-50" />
          </form>
        </>
      )}

      {msg && <p className={`text-xs font-medium ${msg.ok ? "text-primary-deep" : "text-destructive"}`}>{msg.t}</p>}
      
      {!isProcessing && (
        <button form="upload-resource-form" type="submit" disabled={busy || !file || !offeringId} className="press w-full rounded-2xl bg-ai py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40">
          {busy ? "Uploading…" : "Upload"}
        </button>
      )}
    </div>
  );
}
