import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, XCircle, Loader2 } from "lucide-react";
import { Spark } from "@/components/snippet/AppShell";
import { useAvatarUrl } from "@/lib/avatar";
import { api } from "@/lib/api";

export const Route = createFileRoute("/verify/$studentNo")({
  head: () => ({
    meta: [
      { title: "Student Verification — Snippet" },
      { name: "description", content: "Verify a Snippet digital student ID card." },
    ],
  }),
  component: Verify,
});

type VerificationResponse = {
  verified: boolean;
  student: {
    full_name: string;
    student_no: string;
    program?: string;
    branch?: string;
    branch_code?: string;
    division?: string;
    batch?: string;
    expected_graduation?: number;
    role: string;
  };
  error?: string;
  message?: string;
};

function Verify() {
  const { studentNo } = Route.useParams();
  
  const q = useQuery({
    queryKey: ["verify-student", studentNo],
    queryFn: async () => {
      try {
        const data = await api<VerificationResponse>(`/auth/verify-student/${encodeURIComponent(studentNo)}`);
        return data;
      } catch (error: any) {
        if (error?.status === 404) {
          return { verified: false, error: 'not_found' };
        }
        return { verified: false, error: error?.message || 'network_error' };
      }
    },
  });

  const student = q.data?.verified ? q.data.student : null;

  return (
    <div className="min-h-screen bg-ambient px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <p className="flex items-center justify-center gap-1.5 text-sm font-semibold">
          <Spark className="text-primary-deep" /> Snippet ID Verification
        </p>
        
        {q.isLoading ? (
          <div className="surface mt-8 rounded-[26px] p-6 text-center">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">Verifying student ID…</p>
          </div>
        ) : q.data?.verified && student ? (
          <div className="glass rise mt-8 rounded-[26px] p-6 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
              <BadgeCheck className="h-10 w-10 text-primary" />
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-deep">
              <BadgeCheck className="h-4 w-4" /> Verified Student
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{student.full_name}</h1>
            <p className="mt-1 font-mono text-xs tracking-wider text-muted-foreground">
              {student.student_no}
            </p>
            
            {student.program && (
              <p className="mt-3 text-sm text-muted-foreground">{student.program}</p>
            )}
            
            {(student.branch || student.division || student.batch) && (
              <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                {student.branch && (
                  <p>
                    {student.branch} {student.branch_code && `(${student.branch_code})`}
                  </p>
                )}
                {student.division && <p>Division {student.division}</p>}
                {student.batch && <p>Batch {student.batch}</p>}
              </div>
            )}
            
            {student.expected_graduation && (
              <p className="mt-3 inline-block rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                Expected Graduation: {student.expected_graduation}
              </p>
            )}
          </div>
        ) : (
          <div className="surface mt-8 rounded-[26px] p-6 text-center">
            <XCircle className="mx-auto h-10 w-10 text-destructive" />
            <h1 className="mt-3 text-lg font-semibold">Student Not Found</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {q.data?.error === 'not_found' || q.data?.message
                ? q.data.message || "This ID isn't registered with Snippet."
                : "Unable to verify this ID. Please check the QR code and try again."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">ID: {studentNo}</p>
          </div>
        )}
        
        <Link to="/auth" className="mt-6 block text-center text-sm text-primary hover:underline">
          Open Snippet
        </Link>
      </div>
    </div>
  );
}

