import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, FileText, Mic, ArrowUp } from "lucide-react";
import { useState, useEffect } from "react";
import { AppShell, Spark } from "@/components/snippet/AppShell";
import { api, fetchSubjects, SUBJECTS_QUERY_KEY } from "@/lib/api";

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

function Ask() {
  const router = useRouter();
  const subjectsQuery = useQuery({
    queryKey: SUBJECTS_QUERY_KEY,
    queryFn: fetchSubjects,
  });
  const subjects = subjectsQuery.data ?? [];
  const [subject, setSubject] = useState<string>("");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!subject && subjects.length > 0) {
      setSubject(subjects[0]?.id || "");
    }
  }, [subject, subjects]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const currentSubjectId = subject || (subjects.length > 0 ? subjects[0]?.id : "");

    setMsgs((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");

    if (!currentSubjectId) {
      setMsgs((m) => [
        ...m,
        {
          role: "ai",
          text: "No subjects or course materials have been assigned to your account yet. Ask Snippet answers questions grounded in your faculty's uploaded notes, slides, and PDFs.\n\nPlease ask your administrator or faculty to assign your class sections and upload syllabus materials.",
        },
      ]);
      return;
    }

    setLoading(true);

    try {
      const res = await api<{ answer: string; sources: any[] }>("/ask", {
        method: "POST",
        body: { query: trimmed, subjectId: currentSubjectId },
      });
      setMsgs((m) => [...m, { role: "ai", text: res.answer, sources: res.sources }]);
    } catch (err: any) {
      setMsgs((m) => [...m, { role: "ai", text: err.message || "Failed to get answer." }]);
    } finally {
      setLoading(false);
    }
  };

  const selectedSubject = subjects.find((s) => s.id === (subject || subjects[0]?.id));
  const selectedSubjectName = selectedSubject?.name || "your course material";

  return (
    <AppShell hideAsk>
      <header className="flex items-center justify-between">
        <button onClick={() => router.history.back()} aria-label="Back" className="glass press grid h-11 w-11 place-items-center rounded-full">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground">
          <Spark /> Based on your course material
        </span>
      </header>

      {msgs.length === 0 ? (
        <section className="rise flex flex-col items-center pt-14 text-center">
          <div className="orb h-24 w-24 rounded-full" />
          <h1 className="mt-8 text-[26px] font-semibold tracking-tight">How can I help you study?</h1>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">Answers come from your notes, slides and PDFs — with sources.</p>
          
          {!subjectsQuery.isLoading && subjects.length === 0 && (
            <div className="surface mt-5 max-w-xs rounded-2xl p-3.5 text-xs text-muted-foreground text-center">
              No subjects have been assigned to your class yet. You can still test asking questions below.
            </div>
          )}

          <div className="mt-8 w-full space-y-2">
            {prompts.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => send(p)}
                disabled={loading}
                className="surface press w-full rounded-[18px] px-4 py-3 text-left text-sm disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="mt-8 space-y-4">
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="rise ml-auto w-fit max-w-[85%] rounded-[20px] rounded-br-md bg-foreground px-4 py-2.5 text-sm text-background">
                {m.text}
              </p>
            ) : (
              <div key={i} className="rise">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                  <span className="orb h-5 w-5 rounded-full" /> Snippet
                </div>
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{m.text}</p>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.sources.map((s, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
                        <FileText className="h-3 w-3" />
                        {s.filename} · p.{s.pageNumber}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          {loading && (
            <div className="rise">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <span className="orb h-5 w-5 rounded-full animate-pulse" /> Snippet is thinking...
              </div>
            </div>
          )}
        </section>
      )}

      <div className="fixed inset-x-0 bottom-24 z-30 mx-auto w-[calc(100%-2rem)] max-w-md">
        <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {subjectsQuery.isLoading ? (
            <span className="text-xs text-muted-foreground px-2">Loading subjects…</span>
          ) : subjects.length > 0 ? (
            subjects.map((s) => {
              const isSelected = subject ? subject === s.id : s.id === subjects[0]?.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSubject(s.id)}
                  className={`press shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${
                    isSelected ? "bg-foreground text-background" : "glass"
                  }`}
                >
                  {s.name}
                </button>
              );
            })
          ) : (
            <span className="text-xs text-muted-foreground px-2">No subjects assigned yet</span>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="glass flex items-center gap-1 rounded-[24px] p-1.5"
        >
          <button type="button" aria-label="Camera" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground">
            <Camera className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Attach document" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground">
            <FileText className="h-5 w-5" />
          </button>
          <input
            disabled={loading}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={selectedSubject ? `Ask about ${selectedSubject.name}…` : "Ask a study question…"}
            className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-hidden placeholder:text-muted-foreground disabled:opacity-50"
          />
          {input.trim() ? (
            <button
              type="submit"
              disabled={loading}
              aria-label="Send"
              className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ai text-primary-foreground disabled:opacity-50"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          ) : (
            <button type="button" aria-label="Voice" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foreground text-background">
              <Mic className="h-4 w-4" />
            </button>
          )}
        </form>
      </div>
    </AppShell>
  );
}
