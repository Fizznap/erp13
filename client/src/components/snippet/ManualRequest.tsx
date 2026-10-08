import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Fallback when the code/GPS check fails: the student asks faculty to approve them by hand.
export function ManualRequest({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (msg?.ok) return <p className="px-5 pb-5 text-center text-xs font-medium text-primary-deep">{msg.t}</p>;
  if (!open)
    return <button onClick={() => setOpen(true)} className="mx-auto block px-5 pb-5 text-xs font-medium text-muted-foreground underline">Code or location not working? Ask faculty to approve you</button>;
  return (
    <form className="space-y-2 px-5 pb-5" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg(null);
      const { error } = await supabase.rpc("request_manual_attendance", { _session_id: sessionId, _reason: reason });
      setBusy(false);
      setMsg(error ? { ok: false, t: error.message } : { ok: true, t: "Request sent. Your faculty will approve it." });
    }}>
      <input required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What went wrong? e.g. GPS not detected" className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-hidden focus:border-primary" />
      {msg && <p className="text-xs text-destructive">{msg.t}</p>}
      <button disabled={busy || !reason.trim()} className="press w-full rounded-2xl border border-border bg-card py-3 text-sm font-semibold disabled:opacity-40">{busy ? "Sending…" : "Send request to faculty"}</button>
    </form>
  );
}
