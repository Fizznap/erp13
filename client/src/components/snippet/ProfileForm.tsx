import { useState } from "react";
import { api } from "@/lib/api";
import type { SnippetUser } from "@/hooks/use-auth";

export function ProfileForm({
  user,
  onSaved,
}: {
  user: SnippetUser | undefined;
  onSaved?: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const profile = user?.profile;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    const data = new FormData(e.currentTarget);
    const list = (key: string) =>
      String(data.get(key) || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const body = {
      fullName: data.get("fullName"),
      collegeId: data.get("collegeId"),
      program: data.get("program"),
      rollNumber: data.get("rollNumber"),
      yearOfStudy: data.get("yearOfStudy"),
      admissionYear: data.get("admissionYear"),
      expectedGraduationYear: data.get("expectedGraduationYear"),
      preferredName: data.get("preferredName"),
      phone: data.get("phone"),
      bio: data.get("bio"),
      skills: list("skills"),
      interests: list("interests"),
      achievements: list("achievements"),
      linkedinUrl: data.get("linkedinUrl"),
      githubUrl: data.get("githubUrl"),
      portfolioUrl: data.get("portfolioUrl"),
      password: data.get("password"),
    };
    try {
      await api("/auth/me", { method: "PATCH", body });
      await onSaved?.();
      setMsg("Profile updated successfully");
      ((e.target as HTMLFormElement).elements.namedItem("password") as HTMLInputElement).value = "";
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const textInput = (
    name: string,
    label: string,
    value: string | number | null | undefined,
    type = "text",
  ) => (
    <label className="flex flex-col gap-1" key={name}>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={value ?? ""}
        maxLength={name === "bio" ? 500 : 160}
        className="rounded-xl border border-border bg-card p-3 text-sm outline-none"
      />
    </label>
  );
  const arrayInput = (name: string, label: string, value?: string[]) =>
    textInput(name, `${label} (comma separated)`, value?.join(", ") || "");

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {msg && (
        <div role="status" className="text-sm text-primary-deep">
          {msg}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {textInput("fullName", "Account name", user?.fullName)}
        {textInput("preferredName", "Name shown in Snippet", profile?.preferredName)}
        {textInput("collegeId", "College ID / PRN (self-reported)", profile?.collegeId)}
        {textInput("program", "Program", profile?.program)}
        {textInput("rollNumber", "Roll number", profile?.rollNumber)}
        {textInput("yearOfStudy", "Study year", profile?.yearOfStudy, "number")}
        {textInput("admissionYear", "Admission year", profile?.admissionYear, "number")}
        {textInput(
          "expectedGraduationYear",
          "Expected graduation year",
          profile?.expectedGraduationYear,
          "number",
        )}
        {textInput("phone", "Phone", profile?.phone, "tel")}
      </div>
      <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
        College email: {user?.email || "—"}. Branch/class assignment is managed through your
        academic record.
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted-foreground">Bio</span>
        <textarea
          name="bio"
          rows={3}
          defaultValue={profile?.bio || ""}
          maxLength={500}
          className="rounded-xl border border-border bg-card p-3 text-sm outline-none"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {arrayInput("skills", "Skills", profile?.skills)}
        {arrayInput("interests", "Interests", profile?.interests)}
        {arrayInput("achievements", "Achievements", profile?.achievements)}
        {textInput("linkedinUrl", "LinkedIn URL", profile?.linkedinUrl, "url")}
        {textInput("githubUrl", "GitHub URL", profile?.githubUrl, "url")}
        {textInput("portfolioUrl", "Portfolio URL", profile?.portfolioUrl, "url")}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted-foreground">New Password</span>
        <input
          type="password"
          name="password"
          minLength={6}
          placeholder="Leave blank to keep current"
          className="rounded-xl border border-border bg-card p-3 text-sm outline-none"
        />
      </label>
      <button
        disabled={loading}
        type="submit"
        className="press mt-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground disabled:opacity-50"
      >
        {loading ? "Saving…" : "Save Changes"}
      </button>
    </form>
  );
}
