import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { SectionTitle } from "./AppShell";

export function ManualApprovals() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["manual-requests"],
    queryFn: async (): Promise<any[]> => [],
    refetchInterval: 8000,
  });
  const review = async (id: string, approve: boolean) => {
    // dummy
    qc.invalidateQueries({ queryKey: ["manual-requests"] });
    qc.invalidateQueries({ queryKey: ["attendees"] });
  };
  return (
    <>
      <SectionTitle action={<span className="text-xs text-muted-foreground">{q.data?.length ?? 0} waiting</span>}>Approve manually</SectionTitle>
      <div className="space-y-3">
        {q.data?.length === 0 && <p className="surface rounded-[22px] p-4 text-sm text-muted-foreground">No requests. Students whose code or location fails can ask you here.</p>}
        {q.data?.map((r) => (
          <div key={r.id} className="surface rounded-[22px] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.student_name}</p>
                <p className="truncate text-xs text-muted-foreground">{[r.student_no, r.subject_name, r.section_name].filter(Boolean).join(" · ")}</p>
                <p className="mt-1 text-sm">“{r.reason}”</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => review(r.id, true)} className="press flex items-center justify-center gap-1.5 rounded-2xl bg-ai py-2.5 text-sm font-semibold text-primary-foreground"><Check className="h-4 w-4" /> Mark present</button>
              <button onClick={() => review(r.id, false)} className="press flex items-center justify-center gap-1.5 rounded-2xl border border-border bg-card py-2.5 text-sm font-semibold"><X className="h-4 w-4" /> Reject</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
