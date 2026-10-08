import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/hooks/use-auth";
import { clearTokens } from "@/lib/api";
import { Menu, Home, GraduationCap, CalendarCheck, FolderOpen, Award, Bell, IdCard, Settings, LogOut, Presentation, LogIn } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spark } from "./AppShell";
import { useAvatarUrl } from "@/lib/avatar";

const items = [
  { label: "Home", icon: Home, to: "/" },
  { label: "Classroom", icon: GraduationCap, to: "/subjects/$subjectId" },
  { label: "Attendance", icon: CalendarCheck, to: "/attendance" },
  { label: "Resources", icon: FolderOpen, to: "/resources" },
  { label: "Results", icon: Award, to: "/subjects/$subjectId" },
  { label: "Reminders", icon: Bell, to: "/reminders" },
  { label: "My ID Card", icon: IdCard, to: "/profile" },
] as const;

export function MenuSheet() {
  const { me } = useMe();
  const student = useAvatarUrl(me?.avatar);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signOut = async () => {
    await qc.cancelQueries(); qc.clear();
    clearTokens();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <Sheet>
      <SheetTrigger aria-label="Open menu" className="glass press grid h-11 w-11 place-items-center rounded-full">
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-[82%] max-w-xs border-r-0 bg-background p-0">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <div className="flex h-full flex-col bg-ambient p-5 pt-14">
          <Link to="/profile" className="surface flex items-center gap-3 rounded-[22px] p-3">
            {student ? <img src={student} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-full object-cover object-top" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-muted font-semibold">{me?.name?.[0] ?? "?"}</span>}
            <div className="min-w-0">
              <p className="truncate font-semibold">{me?.name ?? "…"}</p>
              <p className="truncate text-xs text-muted-foreground">{me?.subtitle ?? ""}</p>
            </div>
          </Link>
          <nav className="mt-6 flex-1 space-y-1">
            {items.map((i) => (
              <Link key={i.label} to={i.to} params={{ subjectId: "dbms" } as never}
                className="press flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium hover:bg-card">
                <i.icon className="h-[18px] w-[18px] text-muted-foreground" /> {i.label}
              </Link>
            ))}
            {me?.isAdmin && (
            <Link to="/admin" className="press flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium hover:bg-card">
              <Settings className="h-[18px] w-[18px] text-muted-foreground" /> Admin approvals
            </Link>
          )}
            <Link to="/faculty" className="press flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium hover:bg-card">
              <Presentation className="h-[18px] w-[18px] text-muted-foreground" /> {me?.isFaculty ? "Faculty tools" : "I'm faculty"}
            </Link>
            <Link to="/ask" className="press mt-3 flex items-center gap-3 rounded-2xl bg-accent px-3 py-2.5 text-sm font-semibold text-accent-foreground">
              <Spark /> Ask Snippet
            </Link>
          </nav>
          <div className="space-y-1 border-t border-border pt-3">
            <Link to="/profile" className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-muted-foreground"><Settings className="h-[18px] w-[18px]" /> Profile details</Link>
            {me ? (
              <button onClick={signOut} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-destructive"><LogOut className="h-[18px] w-[18px]" /> Log out</button>
            ) : (
              <Link to="/auth" className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium"><LogIn className="h-[18px] w-[18px]" /> Sign in</Link>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
