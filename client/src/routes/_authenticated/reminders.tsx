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
        <p className="surface rounded-[22px] p-4 text-sm text-muted-foreground">No reminders have been published.</p>
      </div>
    </AppShell>
  ),
});
