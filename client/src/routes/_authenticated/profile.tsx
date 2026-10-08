import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useAvatarUrl } from "@/lib/avatar";
import { ArrowLeft, Pencil, RotateCw, Mail, GraduationCap, Calendar, ScanFace, ChevronRight } from "lucide-react";
import { useFaceStatus } from "@/lib/face";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AppShell, SectionTitle, Spark } from "@/components/snippet/AppShell";
import { useMe } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "My Profile & ID Card — Snippet" },
      { name: "description", content: "Your digital student ID card with a scannable QR code for attendance, library and campus entry." },
    ],
  }),
  component: Profile,
});

function Profile() {
  const router = useRouter();
  const { me, loading } = useMe();
  const [flip, setFlip] = useState(false);
  const face = useFaceStatus();

  if (loading) return <AppShell><p>Loading...</p></AppShell>;

  const studentId = me?.user.id ? me.user.id.substring(0, 8).toUpperCase() : "N/A";
  const roleName = me?.user.role === 'faculty' ? 'Faculty' : me?.user.role === 'admin' ? 'Admin' : 'Student';
  const verifyUrl = typeof window !== "undefined" ? `${window.location.origin}/verify/${studentId}` : "";
  const studentPic = useAvatarUrl(null); // No avatar in schema currently

  return (
    <AppShell>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <button onClick={() => router.history.back()} aria-label="Back" className="glass press grid h-11 w-11 place-items-center rounded-full"><ArrowLeft className="h-5 w-5" /></button>
        <p className="truncate text-center font-semibold">My ID Card</p>
        <span className="h-11 w-11" /> {/* Removing edit for now since schema has no extra fields */}
      </header>

      <div className="flip-scene rise mx-auto mt-8 w-full max-w-[300px]">
        <button onClick={() => setFlip((f) => !f)} aria-label="Flip ID card" className="flip-inner relative block aspect-[5/8] w-full text-left" data-flipped={flip} style={{ transform: flip ? "rotateY(180deg)" : undefined }}>
          {/* Front */}
          <div className="face absolute inset-0 overflow-hidden rounded-[26px] bg-id text-id-foreground shadow-float">
            {studentPic && <img src={studentPic} alt={me?.user.fullName} width={768} height={1024} className="absolute inset-x-0 bottom-0 h-[78%] w-full object-cover object-top [mask-image:linear-gradient(to_bottom,transparent,black_18%)]" />}
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-id-ink to-transparent" />
            <p aria-hidden className="absolute -right-3 top-6 text-[64px] font-bold leading-none opacity-10">USTU<br />2026</p>
            <div className="relative p-5">
              <p className="flex items-center gap-1.5 text-sm font-semibold"><Spark className="text-primary" /> Snippet</p>
              <p className="mt-1 text-[11px] opacity-70">University Campus</p>
            </div>
            <div className="absolute inset-x-0 bottom-0 p-5">
              <p className="text-3xl font-bold uppercase leading-none tracking-tight">{me?.user.fullName}</p>
              <span className="mt-2 inline-block rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">{roleName}</span>
            </div>
          </div>
          {/* Back */}
          <div className="face-back absolute inset-0 flex flex-col items-center overflow-hidden rounded-[26px] bg-id p-5 text-id-foreground shadow-float">
            <p className="flex items-center gap-1.5 self-start text-sm font-semibold"><Spark className="text-primary" /> Snippet</p>
            <div className="mt-6 rounded-2xl bg-card p-3">
              {verifyUrl ? <QRCodeSVG value={verifyUrl} size={170} level="M" /> : <div className="grid h-[170px] w-[170px] place-items-center text-center text-xs text-muted-foreground">ID not issued yet</div>}
            </div>
            <p className="mt-4 font-mono text-xs tracking-wider opacity-80">{studentId}</p>
            <p className="mt-auto text-2xl font-bold uppercase tracking-tight">Scan me</p>
            <span className="mt-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">Valid till 06/2026</span>
          </div>
        </button>
      </div>
      <button onClick={() => setFlip((f) => !f)} className="glass press mx-auto mt-5 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium">
        <RotateCw className="h-4 w-4" /> {flip ? "Show front" : "Show QR code"}
      </button>
      <p className="mt-2 text-center text-xs text-muted-foreground">Scanning the QR opens your verified profile</p>

      <SectionTitle>Details</SectionTitle>
      <div className="surface divide-y divide-border rounded-[24px]">
        <div className="flex items-center gap-3 p-4 text-sm"><Mail className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{me?.user.email}</span></div>
        <div className="flex items-center gap-3 p-4 text-sm"><GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{roleName} Role</span></div>
      </div>

    </AppShell>
  );
}
