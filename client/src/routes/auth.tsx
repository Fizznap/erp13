import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Spark } from "@/components/snippet/AppShell";
import { SignInHelp } from "@/components/snippet/SignInHelp";
import { api, setTokens, getStoredUser, setStoredUser } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Snippet" },
      { name: "description", content: "Sign in to Snippet to mark attendance and track your classes." },
      { property: "og:title", content: "Sign in — Snippet" },
      { property: "og:description", content: "Your college, with AI built in." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"student" | "faculty">("student");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // If we already have a user in localStorage, attempt redirect
    const user = getStoredUser();
    if (user) {
      navigate({ to: "/", replace: true });
    }
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "up") {
        const data = await api<{ accessToken: string; refreshToken: string; user: any }>('/auth/register', {
          method: 'POST',
          body: { email, password, fullName: name.trim() || 'User', role },
        });
        setTokens(data.accessToken, data.refreshToken);
        setStoredUser(data.user);
        qc.invalidateQueries();
        navigate({ to: "/", replace: true });
      } else {
        const data = await api<{ accessToken: string; refreshToken: string; user: any }>('/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        setTokens(data.accessToken, data.refreshToken);
        setStoredUser(data.user);
        qc.invalidateQueries();
        navigate({ to: "/", replace: true });
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "Authentication failed" });
    }
    setBusy(false);
  };

  const input = "w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-sm outline-hidden focus:border-primary";

  return (
    <div className="min-h-screen bg-ambient px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="orb mx-auto h-16 w-16 rounded-full" />
        <h1 className="mt-6 text-center text-[26px] font-semibold tracking-tight">{mode === "in" ? "Welcome back" : "Create your account"}</h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground"><Spark className="text-primary-deep" /> Snippet</p>

        <form onSubmit={submit} className="glass mt-8 space-y-3 rounded-[26px] p-5">
          {mode === "up" && (
            <>
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" maxLength={80} className={input} />
              <select value={role} onChange={(e) => setRole(e.target.value as any)} className={input}>
                <option value="student">Student</option>
                <option value="faculty">Faculty</option>
              </select>
            </>
          )}
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="College email" className={input} />
          <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={input} />
          {msg && <p className={`text-xs ${msg.ok ? "text-primary-deep" : "text-destructive"}`}>{msg.text}</p>}
          <button disabled={busy} className="press w-full rounded-2xl bg-foreground py-3.5 text-sm font-semibold text-background disabled:opacity-50">
            {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <button onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }} className="mt-5 w-full text-center text-sm text-muted-foreground">
          {mode === "in" ? "New here? " : "Already have an account? "}
          <span className="font-semibold text-foreground">{mode === "in" ? "Create an account" : "Sign in"}</span>
        </button>
        <SignInHelp page="sign-in" />
      </div>
    </div>
  );
}
