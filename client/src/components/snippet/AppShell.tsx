import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMe } from "@/hooks/use-auth";
import { Home, GraduationCap, UserRound, Rss } from "lucide-react";
import type { ReactNode } from "react";


export function Spark({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`inline-block leading-none ${className}`}>✦</span>;
}

const tabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/subjects/$subjectId", params: { subjectId: "dbms" }, label: "Class", icon: GraduationCap },
  { to: "/ask", label: "AI", ai: true },
  { to: "/resources", label: "Feed", icon: Rss },
  { to: "/profile", label: "Profile", icon: UserRound },
] as const;

export function AppShell({ children, hideAsk }: { children: ReactNode; hideAsk?: boolean }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { me } = useMe();
  const navigate = useNavigate();
  // Students must finish class registration before using the app.
  useEffect(() => { if (me?.needsSetup) navigate({ to: "/onboarding", replace: true }); }, [me?.needsSetup, navigate]);
  return (
    <div className="relative min-h-screen bg-ambient">
      <main className="mx-auto w-full max-w-xl px-5 pb-40 pt-6 md:max-w-3xl md:px-8">{children}</main>

      {!hideAsk && (
        <Link
          to="/ask"
          className="press fixed bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ai px-5 py-3 text-sm font-semibold text-primary-foreground shadow-float"
        >
          <Spark /> Ask Snippet
        </Link>
      )}

      <nav className="glass fixed inset-x-0 bottom-4 z-20 mx-auto flex w-[calc(100%-2rem)] max-w-md items-center justify-between rounded-[26px] px-2 py-2">
        {tabs.map((t) => {
          const active =
            t.to === "/" ? path === "/" : path.startsWith(t.to.split("/$")[0] ?? t.to);
          return (
            <Link
              key={t.label}
              to={t.to}
              params={("params" in t ? t.params : {}) as never}
              className={`press flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[11px] font-medium transition-colors ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {"ai" in t ? (
                <span className={`grid h-6 w-6 place-items-center rounded-full ${active ? "bg-ai" : "bg-accent"} text-primary-foreground`}>
                  <Spark className="text-xs" />
                </span>
              ) : (
                <t.icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
              )}
              <span>{t.label}</span>
              <span className={`h-1 w-1 rounded-full ${active ? "bg-primary-deep" : "bg-transparent"}`} />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between">
      <h2 className="text-base font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-ai transition-all duration-700" style={{ width: `${value}%` }} />
    </div>
  );
}
