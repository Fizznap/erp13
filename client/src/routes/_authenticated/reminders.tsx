import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/snippet/AppShell";

export const Route = createFileRoute("/_authenticated/reminders")({
  head: () => ({
    meta: [
      { title: "Reminders — Snippet" },
      { name: "description", content: "Upcoming assignments, tests and deadlines." },
      { property: "og:title", content: "Reminders — Snippet" },
      { property: "og:description", content: "Never miss a deadline." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <AppShell>
      <h1 className="rise text-[28px] font-semibold tracking-tight">Reminders</h1>
      <div className="mt-6 space-y-3">
        {[["DBMS Assignment 2", "Due tomorrow, 11:59 PM", "bg-peach"], ["OS Internal Test 2", "Mon, 12 Oct • 10:00", "bg-lavender"], ["CN Lab record", "Fri, 16 Oct", "bg-sky"]].map(([t, d, c]) => (
          <div key={t} className="surface flex items-center gap-3 rounded-[22px] p-4">
            <span className={`h-10 w-1.5 shrink-0 rounded-full ${c}`} />
            <div className="min-w-0"><p className="truncate font-medium">{t}</p><p className="text-xs text-muted-foreground">{d}</p></div>
          </div>
        ))}
      </div>
    </AppShell>
  ),
});
