import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Radio, UserCheck, Upload, Users, ArrowRight } from "lucide-react";
import { SectionTitle } from "./AppShell";

// Simple, big-button home for faculty: each card is one job.
export function FacultyHome({ name }: { name: string }) {
  const pending = useQuery({
    queryKey: ["manual-requests"],
    queryFn: async (): Promise<any[]> => [],
    refetchInterval: 15000,
  });
  const sections = useQuery({
    queryKey: ["my-sections-home"],
    queryFn: async (): Promise<any[]> => [],
  });
  const count = pending.data?.length ?? 0;

  const actions = [
    { to: "/faculty", label: "Start attendance", hint: "Open a session and show the code", icon: Radio, tint: "bg-ai text-primary-foreground" },
    { to: "/faculty", label: "Approve students", hint: count ? `${count} waiting for you` : "Manual requests if code/GPS failed", icon: UserCheck, tint: "bg-mint", badge: count },
    { to: "/resources", label: "Upload resources", hint: "Notes, slides and PDFs by subject", icon: Upload, tint: "bg-sky" },
    { to: "/faculty", label: "My classes", hint: "Branches, divisions and students", icon: Users, tint: "bg-lavender" },
  ] as const;

  return (
    <>
      <h1 className="rise mt-8 text-[28px] font-semibold leading-tight tracking-tight sm:text-4xl">Hello, {name.split(" ")[0]}<br />What's next?</h1>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {actions.map((a) => (
          <Link key={a.label} to={a.to} className={`press rise relative flex items-center gap-4 rounded-[24px] p-5 ${a.tint === "bg-ai text-primary-foreground" ? `${a.tint} shadow-float` : "surface"}`}>
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${a.tint === "bg-ai text-primary-foreground" ? "bg-card/40" : a.tint}`}><a.icon className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold">{a.label}</span>
              <span className="block truncate text-xs opacity-75">{a.hint}</span>
            </span>
            {"badge" in a && a.badge ? <span className="grid h-6 min-w-6 place-items-center rounded-full bg-destructive px-1.5 text-xs font-bold text-background">{a.badge}</span> : <ArrowRight className="h-4 w-4 shrink-0 opacity-60" />}
          </Link>
        ))}
      </div>

      <SectionTitle action={<Link to="/faculty" className="text-xs font-medium text-primary-deep">Manage</Link>}>My classes</SectionTitle>
      {sections.data?.length === 0 && <p className="surface rounded-[22px] p-4 text-sm text-muted-foreground">No classes yet. Tap “My classes” to add your first branch and division.</p>}
      <div className="flex flex-wrap gap-2">
        {sections.data?.map((s) => (
          <span key={s.id} className="surface rounded-full px-3 py-1.5 text-xs font-medium">
            {s.subjects?.code} · {[s.branch, s.division && `Div ${s.division}`].filter(Boolean).join(" ") || s.name}
          </span>
        ))}
      </div>
    </>
  );
}
