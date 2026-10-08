import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Camera, FileText, Mic, ArrowUp } from "lucide-react";
import { useState, useEffect } from "react";
import { AppShell, Spark } from "@/components/snippet/AppShell";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/ask")({
  head: () => ({
    meta: [
      { title: "Ask Snippet — AI for your course material" },
      { name: "description", content: "Ask questions and get answers grounded in your own course resources, with citations." },
      { property: "og:title", content: "Ask Snippet — AI for your course material" },
      { property: "og:description", content: "Course-grounded answers with source citations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Ask,
});

const prompts = ["Explain 3NF with an example", "Summarise Unit 2 of OS", "Quiz me on TCP vs UDP"];

type Msg = { role: "user" | "ai"; text: string; sources?: any[] };
type Subject = { id: string; name: string; code: string };

function Ask() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subject, setSubject] = useState<string>("");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadSubjects() {
      try {
        const res = await api<{ subjects: Subject[] }>("/subjects");
        setSubjects(res.subjects);
        if (res.subjects.length > 0) {
          setSubject(res.subjects[0]?.id || "");
        }
      } catch (err) {
        console.error("Failed to load subjects", err);
      }
    }
    loadSubjects();
  }, []);

  const send = async (text: string) => {
    if (!text.trim() || !subject) return;
    const currentSubjectId = subject;
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await api<{ answer: string; sources: any[] }>("/ask", {
        method: "POST",
        body: { query: text, subjectId: currentSubjectId },
      });
      setMsgs((m) => [...m, { role: "ai", text: res.answer, sources: res.sources }]);
    } catch (err: any) {
      setMsgs((m) => [...m, { role: "ai", text: err.message || "Failed to get answer." }]);
    } finally {
      setLoading(false);
    }
  };

  const selectedSubjectName = subjects.find(s => s.id === subject)?.name || "a subject";

  return (
    <AppShell hideAsk>
      <header className="flex items-center justify-between">
        <button onClick={() => router.history.back()} aria-label="Back" className="glass press grid h-11 w-11 place-items-center rounded-full"><ArrowLeft className="h-5 w-5" /></button>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"><Spark /> Based on your course material</span>
      </header>

      {msgs.length === 0 ? (
        <section className="rise flex flex-col items-center pt-14 text-center">
          <div className="orb h-24 w-24 rounded-full" />
          <h1 className="mt-8 text-[26px] font-semibold tracking-tight">How can I help you study?</h1>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">Answers come from your notes, slides and PDFs — with sources.</p>
          <div className="mt-8 w-full space-y-2">
            {prompts.map((p) => (
              <button key={p} onClick={() => send(p)} disabled={!subject || loading} className="surface press w-full rounded-[18px] px-4 py-3 text-left text-sm disabled:opacity-50">{p}</button>
            ))}
          </div>
        </section>
      ) : (
        <section className="mt-8 space-y-4">
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="rise ml-auto w-fit max-w-[85%] rounded-[20px] rounded-br-md bg-foreground px-4 py-2.5 text-sm text-background">{m.text}</p>
            ) : (
              <div key={i} className="rise">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold"><span className="orb h-5 w-5 rounded-full" /> Snippet</div>
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{m.text}</p>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.sources.map((s, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground"><FileText className="h-3 w-3" />{s.filename} · p.{s.pageNumber}</span>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          {loading && (
            <div className="rise">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><span className="orb h-5 w-5 rounded-full animate-pulse" /> Snippet is thinking...</div>
            </div>
          )}
        </section>
      )}

      <div className="fixed inset-x-0 bottom-24 z-30 mx-auto w-[calc(100%-2rem)] max-w-md">
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {subjects.map((s) => (
            <button key={s.id} onClick={() => setSubject(s.id)} className={`press shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${subject === s.id ? "bg-foreground text-background" : "glass"}`}>{s.name}</button>
          ))}
          {subjects.length === 0 && <span className="text-xs text-muted-foreground px-2">No subjects available</span>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="glass flex items-center gap-1 rounded-[24px] p-1.5">
          <button type="button" aria-label="Camera" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground"><Camera className="h-5 w-5" /></button>
          <button type="button" aria-label="Attach document" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground"><FileText className="h-5 w-5" /></button>
          <input disabled={!subject || loading} value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Ask about ${selectedSubjectName}…`} className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-hidden placeholder:text-muted-foreground disabled:opacity-50" />
          {input ? (
            <button disabled={!subject || loading} aria-label="Send" className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ai text-primary-foreground disabled:opacity-50"><ArrowUp className="h-5 w-5" /></button>
          ) : (
            <button type="button" aria-label="Voice" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foreground text-background"><Mic className="h-4 w-4" /></button>
          )}
        </form>
      </div>
    </AppShell>
  );
}
