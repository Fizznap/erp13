import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Spark } from "@/components/snippet/AppShell";
import { SignInHelp } from "@/components/snippet/SignInHelp";
import { api, setTokens, setOnboardingToken, getStoredUser, setStoredUser } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

const GOOGLE_CLIENT_ID = import.meta.env["VITE_GOOGLE_CLIENT_ID"] as string | undefined;
const ADMIN_EMAIL = (import.meta.env["VITE_ADMIN_EMAIL"] as string | undefined || "smit2shinde2@gmail.com").trim().toLowerCase();
type AuthResponse = {
  accessToken: string;
  refreshToken: string | null;
  requiresOnboarding?: boolean;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: "student" | "faculty" | "admin";
    isActive: boolean;
    academicClassId: string | null;
    createdAt: string;
  };
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string>) => void;
        };
      };
    };
  }
}

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Snippet" },
      {
        name: "description",
        content: "Sign in to Snippet to mark attendance and track your classes.",
      },
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
  const [msg, setMsg] = useState<{ ok: boolean; text: string; canResend?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);

  const finishLogin = useCallback(
    (data: AuthResponse) => {
      if (data.requiresOnboarding) {
        setOnboardingToken(data.accessToken);
        setStoredUser(data.user);
        qc.invalidateQueries();
        navigate({ to: "/complete-profile", replace: true });
        return;
      }
      setTokens(data.accessToken, data.refreshToken);
      setStoredUser(data.user);
      qc.invalidateQueries();
      navigate({ to: "/", replace: true });
    },
    [navigate, qc],
  );

  useEffect(() => {
    if (!getStoredUser() || !localStorage.getItem("snippet_token")) return;
    void api<{ requiresOnboarding?: boolean }>("/auth/me")
      .then((data) => {
        navigate({ to: data.requiresOnboarding ? "/complete-profile" : "/", replace: true });
      })
      .catch(() => {});
  }, [navigate]);

  useEffect(() => {
    const verificationToken = new URLSearchParams(window.location.search).get("verifyEmail");
    if (!verificationToken) return;

    window.history.replaceState({}, "", "/auth");
    setBusy(true);
    void api<{ message: string }>("/auth/verify-email", {
      method: "POST",
      body: { token: verificationToken },
    })
      .then((result) => {
        setMsg({ ok: true, text: result.message });
        setMode("in");
      })
      .catch((error: unknown) => {
        setMsg({ ok: false, text: getErrorMessage(error, "Email verification failed") });
      })
      .finally(() => setBusy(false));
  }, []);

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      setBusy(true);
      setMsg(null);
      try {
        const data = await api<AuthResponse>("/auth/google", {
          method: "POST",
          body: { credential },
        });
        finishLogin(data);
      } catch (err: unknown) {
        setMsg({ ok: false, text: getErrorMessage(err, "Google sign-in failed") });
      }
      setBusy(false);
    },
    [finishLogin],
  );

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButton.current) return;

    const renderGoogleButton = () => {
      if (!window.google || !googleButton.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: ({ credential }) => {
          void handleGoogleCredential(credential);
        },
      });
      window.google.accounts.id.renderButton(googleButton.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: "350",
      });
      setGoogleReady(true);
    };

    if (window.google) {
      renderGoogleButton();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    const script = existingScript ?? document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", renderGoogleButton, { once: true });
    if (!existingScript) document.head.appendChild(script);
    return () => script.removeEventListener("load", renderGoogleButton);
  }, [handleGoogleCredential]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const normalizedEmail = email.trim().toLowerCase();
    const isCollegeEmail = /^[^@\s]+@ustu\.edu\.in$/i.test(normalizedEmail);
    if (mode === "up" ? !isCollegeEmail : !isCollegeEmail && normalizedEmail !== ADMIN_EMAIL) {
      setMsg({ ok: false, text: mode === "up" ? "Only @ustu.edu.in college emails can register." : "Use your registered account email." });
      return;
    }
    setBusy(true);
    try {
      if (mode === "up") {
        const result = await api<{ message: string }>("/auth/register", {
          method: "POST",
          body: { email, password, fullName: name.trim() },
        });
        setMsg({ ok: true, text: result.message });
      } else {
        const data = await api<AuthResponse>("/auth/login", {
          method: "POST",
          body: { email, password },
        });
        finishLogin(data);
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err, "Authentication failed");
      setMsg({
        ok: false,
        text: message,
        canResend: message === "Verify your college email before signing in",
      });
    }
    setBusy(false);
  };

  const resendVerification = async () => {
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/auth/verification/resend", {
        method: "POST",
        body: { email },
      });
      setMsg({ ok: true, text: result.message });
    } catch (err: unknown) {
      setMsg({ ok: false, text: getErrorMessage(err, "Could not send a verification link") });
    }
    setBusy(false);
  };

  const input =
    "w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-sm outline-hidden focus:border-primary";

  return (
    <div className="min-h-screen bg-ambient px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="orb mx-auto h-16 w-16 rounded-full" />
        <h1 className="mt-6 text-center text-[26px] font-semibold tracking-tight">
          {mode === "in" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Spark className="text-primary-deep" /> Snippet
        </p>

        <form onSubmit={submit} className="glass mt-8 space-y-3 rounded-[26px] p-5">
          {mode === "up" && (
            <>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                maxLength={80}
                className={input}
              />
            </>
          )}
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="College email"
            className={input}
          />
          <input
            required
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className={input}
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
            {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <div className="mt-4 flex justify-center">
          {!googleReady && (
            <button
              type="button"
              disabled
              aria-label="Continue with Google is unavailable"
              className="flex h-11 w-full max-w-[350px] items-center justify-center gap-3 rounded-full border border-border bg-white px-4 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span aria-hidden="true" className="font-bold text-[#4285f4]">
                G
              </span>
              Continue with Google
            </button>
          )}
          <div className="flex justify-center" ref={googleButton} />
        </div>
        {!GOOGLE_CLIENT_ID && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Google sign-in is currently unavailable. Use your college email to sign in.
          </p>
        )}
        {msg?.canResend && (
          <button
            disabled={busy}
            onClick={() => void resendVerification()}
            className="mt-3 w-full text-center text-sm font-medium text-primary disabled:opacity-50"
          >
            Resend verification email
          </button>
        )}
{mode === "in" && (
          <Link
            to="/forgot-password"
            className="mt-3 block text-center text-sm text-primary-deep"
          >
            Forgot password?
          </Link>
        )}

        <button
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
            setMsg(null);
          }}
          className="mt-5 w-full text-center text-sm text-muted-foreground"
        >
          {mode === "in" ? "New here? " : "Already have an account? "}
          <span className="font-semibold text-foreground">
            {mode === "in" ? "Create an account" : "Sign in"}
          </span>
        </button>
        <SignInHelp page="sign-in" />
      </div>
    </div>
  );
}
