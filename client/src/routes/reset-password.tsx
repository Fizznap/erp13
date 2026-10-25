import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Mail, Lock, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { AppShell, Spark } from "@/components/snippet/AppShell";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset Password — Snippet" },
      {
        name: "description",
        content: "Set a new password for your Snippet account.",
      },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const resetToken = new URLSearchParams(window.location.search).get("resetToken") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!resetToken) {
      setMsg({ ok: false, text: "Missing reset token. Please use the link from your email." });
      return;
    }
    if (password !== confirmPassword) {
      setMsg({ ok: false, text: "Passwords do not match." });
      return;
    }
    if (password.length < 6) {
      setMsg({ ok: false, text: "Password must be at least 6 characters." });
      return;
    }
    setBusy(true);
    try {
      await api<{ message: string }>("/auth/reset-password", {
        method: "POST",
        body: { token: resetToken, password },
      });
      setMsg({ ok: true, text: "Your password has been reset. You can now sign in." });
      setTimeout(() => navigate({ to: "/auth" }), 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Password reset failed";
      setMsg({ ok: false, text: message });
    } finally {
      setBusy(false);
    }
  };

  if (!resetToken) {
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
              Invalid reset link
            </h1>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <Spark className="text-primary-deep" /> Snippet
            </p>
            <p className="mt-8 text-center text-sm text-muted-foreground">
              The reset link is missing or invalid. Please request a new one.
            </p>
            <Link
              to="/forgot-password"
              className="mt-6 block text-center text-sm font-semibold text-primary-deep"
            >
              Request a new reset link
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

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
            Set a new password
          </h1>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <Spark className="text-primary-deep" /> Snippet
          </p>

          <form onSubmit={submit} className="glass mt-8 space-y-3 rounded-[26px] p-5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
              New password
            </label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
              maxLength={255}
              className="w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-sm outline-hidden focus:border-primary"
            />
            <label className="flex items-center gap-2 text-sm font-medium">
              <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
              Confirm password
            </label>
            <input
              required
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
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
              {busy ? "Resetting…" : "Reset password"}
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
