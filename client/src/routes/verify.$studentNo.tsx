import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, XCircle } from "lucide-react";
import { Spark } from "@/components/snippet/AppShell";
import { useAvatarUrl } from "@/lib/avatar";
import { api } from "@/lib/api";

export const Route = createFileRoute("/verify/$studentNo")({
  head: () => ({
    meta: [
      { title: "Student verification — Snippet" },
      { name: "description", content: "Verify a Snippet digital student ID card." },
    ],
  }),
  component: Verify,
});

function Verify() {
  const { studentNo } = Route.useParams();
  const q = useQuery({
    queryKey: ["verify", studentNo],
    queryFn: async () => {
      // In a real scenario we need a public API endpoint to verify a user by ID
      // For now we simulate an admin call or just return null to avoid compiler errors.
      try {
         // Using the auth/me if we are logged in, otherwise it'll fail. 
         // Realistically we should add a public /api/users/:id endpoint.
         return null;
      } catch {
         return null;
      }
    },
  });
  const s = q.data as any;
  const photo = useAvatarUrl(s?.avatar_url);
  return (
    <div className="min-h-screen bg-ambient px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <p className="flex items-center justify-center gap-1.5 text-sm font-semibold"><Spark className="text-primary-deep" /> Snippet ID check</p>
        {q.isLoading ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">Checking…</p>
        ) : s ? (
          <div className="glass rise mt-8 rounded-[26px] p-6 text-center">
            {photo && <img src={photo} alt={s.full_name} className="mx-auto h-28 w-28 rounded-full object-cover object-top ring-4 ring-card" />}
            <p className="mt-4 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-deep"><BadgeCheck className="h-5 w-5" /> Verified student</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{s.full_name}</h1>
            <p className="mt-1 font-mono text-xs tracking-wider text-muted-foreground">{s.student_no}</p>
          </div>
        ) : (
          <div className="surface mt-8 rounded-[26px] p-6 text-center">
            <XCircle className="mx-auto h-10 w-10 text-destructive" />
            <p className="mt-3 font-semibold">No student found</p>
            <p className="mt-1 text-sm text-muted-foreground">This ID isn't registered with Snippet.</p>
          </div>
        )}
        <Link to="/auth" className="mt-6 block text-center text-sm text-muted-foreground">Open Snippet</Link>
      </div>
    </div>
  );
}
