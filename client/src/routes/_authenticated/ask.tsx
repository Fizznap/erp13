import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, FileText, Mic, ArrowUp, AlertCircle, RotateCcw } from "lucide-react";
import { useState, useEffect, useRef } from "react";
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

function getSubjectPrompts(subj?: { name: string; code: string }) {
  if (!subj) return ["Explain 3NF with an example", "Summarise Unit 2 of OS", "Quiz me on TCP vs UDP"];
  const lower = `${subj.name} ${subj.code}`.toLowerCase();
  if (lower.includes("network") || lower.includes("cn")) {
    return [
      "What are the main functions of network crimping tools?",
      "Summarise the Computer Networks lab manual",
      "Explain the difference between TCP and UDP protocols",
    ];
  }
  if (lower.includes("data structure") || lower.includes("dsa")) {
    return [
      "Explain the difference between BFS and DFS traversal",
      "How do balanced binary search trees maintain O(log n) height?",
      "Quiz me on dynamic programming vs greedy approaches",
    ];
  }
  if (lower.includes("database") || lower.includes("dbms")) {
    return [
      "Explain 3NF and BCNF normalization with examples",
      "What are ACID properties in database transactions?",
      "How do B-Tree indexes speed up range queries?",
    ];
  }
  if (lower.includes("operating") || lower.includes("os")) {
    return [
      "Explain the difference between process and thread",
      "How does the virtual memory page replacement work?",
      "What is deadlock and what are the 4 Coffman conditions?",
    ];
  }
  return [
    `Summarise key topics in ${subj.name}`,
    `Generate 3 practice questions for ${subj.name}`,
    `Explain the foundational concepts in ${subj.code}`,
  ];
}

type MsgStatus = "pending" | "done" | "unsupported" | "error" | "processing";

type Msg = {
  id: string;
  role: "user" | "ai";
  text: string;
  sources?: any[];
  status?: MsgStatus;
  queryToRetry?: string;
  errorMessage?: string;
};

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
  const requestSeq = useRef(0);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (!subject && subjects.length > 0) {
      setSubject(subjects[0]?.id || "");
    }
  }, [subject, subjects]);

  const activeSubjectObj = subjects.find(
    (s: any) => s.id === (subject || (subjects.length > 0 ? subjects[0]?.id : ""))
  );
  const activePrompts = getSubjectPrompts(activeSubjectObj);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSubmittingRef.current || loading) return;

    const currentSubjectId = subject || (subjects.length > 0 ? subjects[0]?.id : "");

    const requestId = ++requestSeq.current;
    const userMsgId = `user-${Date.now()}-${requestId}`;
    const aiMsgId = `ai-${Date.now()}-${requestId}`;

    setMsgs((m) => [
      ...m,
      { id: userMsgId, role: "user", text: trimmed, status: "done" },
      { id: aiMsgId, role: "ai", text: "", status: "pending", queryToRetry: trimmed },
    ]);
    setInput("");

    if (!currentSubjectId) {
      setMsgs((m) =>
        m.map((msg) =>
          msg.id === aiMsgId
            ? {
                ...msg,
                text: "No subjects or course materials have been assigned to your account yet. Ask Snippet answers questions grounded in your faculty's uploaded notes, slides, and PDFs.\n\nPlease ask your administrator or faculty to assign your class sections and upload syllabus materials.",
                status: "done",
              }
            : msg
        )
      );
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);

    try {
      const res = await api<{ answer: string; sources: any[]; wasFound?: boolean; isProcessing?: boolean }>("/ask", {
        method: "POST",
        body: { query: trimmed, subjectId: currentSubjectId },
      });

      if (requestId !== requestSeq.current) return;

      const answer = typeof res.answer === "string" ? res.answer : "";
      let status: MsgStatus = "done";
      if (res.isProcessing) status = "processing";
      else if (answer === "Not in provided material.") status = "unsupported";

      setMsgs((m) =>
        m.map((msg) =>
          msg.id === aiMsgId
            ? {
                ...msg,
                text: answer,
                sources: status === "done" ? res.sources : undefined,
                status,
              }
            : msg
        )
      );
    } catch (err: any) {
      if (requestId !== requestSeq.current) return;
      setMsgs((m) =>
        m.map((msg) =>
          msg.id === aiMsgId
            ? {
                ...msg,
                text: "",
                errorMessage: err.message || "Failed to process question. Please check connection and try again.",
                status: "error",
              }
            : msg
        )
      );
    } finally {
      if (requestId === requestSeq.current) {
        isSubmittingRef.current = false;
        setLoading(false);
      }
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
            {activePrompts.map((p) => (
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
          {msgs.map((m) =>
            m.role === "user" ? (
              <p key={m.id} className="rise ml-auto w-fit max-w-[85%] rounded-[20px] rounded-br-md bg-foreground px-4 py-2.5 text-sm text-background">
                {m.text}
              </p>
            ) : m.status === "pending" ? (
              <div key={m.id} className="rise" data-testid="ask-thinking">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <span className="orb h-5 w-5 rounded-full animate-pulse" /> Snippet is thinking...
                </div>
              </div>
            ) : m.status === "processing" ? (
              <div key={m.id} className="rise rounded-2xl border border-border bg-card/60 p-4" data-answer-kind="processing">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                  <span className="orb h-5 w-5 rounded-full" /> Snippet
                </div>
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{m.text}</p>
              </div>
            ) : m.status === "error" ? (
              <div key={m.id} className="rise rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-destructive">
                  <AlertCircle className="h-4 w-4" /> Unable to process question
                </div>
                <p className="text-xs text-muted-foreground">{m.errorMessage}</p>
                {m.queryToRetry && (
                  <button
                    type="button"
                    onClick={() => send(m.queryToRetry!)}
                    disabled={loading}
                    className="press mt-3 inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Retry question
                  </button>
                )}
              </div>
            ) : m.status === "unsupported" ? (
              <div key={m.id} className="rise rounded-2xl border border-dashed border-border bg-card/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <span className="orb h-5 w-5 rounded-full" /> Snippet
                </div>
                <p className="text-sm font-medium text-foreground">{m.text}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  This answer is not in the course materials currently uploaded for {selectedSubjectName}. Try rephrasing or asking about a topic covered in the syllabus.
                </p>
              </div>
            ) : (
              <div key={m.id} className="rise">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                  <span className="orb h-5 w-5 rounded-full" /> Snippet
                </div>
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{m.text}</p>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.sources.map((s, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
                        <FileText className="h-3 w-3" />
                        {s.filename || s.resource_name} {s.pageNumber ? `· p.${s.pageNumber}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ),
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
