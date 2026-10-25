import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Mail, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { AppShell, Spark } from "@/components/snippet/AppShell";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot Password — Snippet" },
      {
        name: "description",
        content: "Reset your Snippet password.",
      },
    ],
  }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!/^[^\s@]+@ustu\.edu\.in$/i.test(email.trim())) {
      setMsg({ ok: false, text: "Only @ustu.edu.in college emails can reset their password." });
      return;
    }
    setBusy(true);
    try {
      await api<{ message: string }>("/auth/forgot-password", {
        method: "POST",
        body: { email },
      });
      setMsg({ ok: true, text: "If this college account exists and is verified, a password reset link has been sent to your email." });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Password reset request failed";
      setMsg({ ok: false, text: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="min-h-screen bg-ambient px-5 py-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="flex items-center justify-between mb-6">
            <Link
              to="/auth"
              className="glass press grid h-11 w-11 place-items-center rounded-full"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="h-11 w-11" />
          </div>
          <div className="orb mx-auto h-16 w-16 rounded-full" />
          <h1 className="mt-6 text-center text-[26px] font-semibold tracking-tight">
            Reset your password
          </h1>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <Spark className="text-primary-deep" /> Snippet
          </p>

          <form onSubmit={submit} className="glass mt-8 space-y-3 rounded-[26px] p-5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              College email
            </label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@ustu.edu.in"
              maxLength={255}
              className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-sm outline-hidden focus:border-primary"
            />
            {msg && (
              <p className={`text-xs ${msg.ok ? "text-primary-deep" : "text-destructive"}`}>
                {msg.text}
              </p>
            )}
            <button
              disabled={busy}
              className="press w-full rounded-2xl bg-foreground py-3.5 text-sm font-semibold text-background disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Remember your password?{" "}
            <Link to="/auth" className="font-semibold text-primary-deep">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </AppShell>
  );
}
