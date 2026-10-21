import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, Spark } from "@/components/snippet/AppShell";
import { api, clearTokens, setTokens, setStoredUser } from "@/lib/api";

type Profile = {
  preferredName?: string | null;
  googlePictureUrl?: string | null;
  collegeId?: string | null;
  program?: string | null;
  rollNumber?: string | null;
  yearOfStudy?: number | null;
  admissionYear?: number | null;
  expectedGraduationYear?: number | null;
  phone?: string | null;
  bio?: string | null;
  skills?: string[];
  interests?: string[];
  achievements?: string[];
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
};
type User = { id: string; email: string; fullName: string; role: string; profile?: Profile };
type ClassOption = {
  id: string;
  branch_name: string;
  branch_code: string;
  start_year: number;
  end_year: number;
  division_name: string;
  semester_number: number;
};
type FormKey =
  | "preferredName"
  | "collegeId"
  | "program"
  | "rollNumber"
  | "yearOfStudy"
  | "admissionYear"
  | "expectedGraduationYear"
  | "academicClassId"
  | "phone"
  | "bio"
  | "skills"
  | "interests"
  | "achievements"
  | "linkedinUrl"
  | "githubUrl"
  | "portfolioUrl";
type FormValues = Partial<Record<FormKey, string>>;

export const Route = createFileRoute("/complete-profile")({
  ssr: false,
  beforeLoad: () => {
    if (typeof window === "undefined" || !localStorage.getItem("snippet_token"))
      throw redirect({ to: "/auth" });
  },
  component: CompleteProfile,
});

const inputClass =
  "w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-hidden focus:border-primary";
const labelClass = "mb-1 block text-xs font-semibold text-muted-foreground";

function CompleteProfile() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [values, setValues] = useState<FormValues>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([
      api<{ user: User; requiresOnboarding: boolean }>("/auth/me"),
      api<{ classes: ClassOption[] }>("/auth/onboarding/options"),
    ])
      .then(([me, options]) => {
        if (!alive) return;
        if (!me.requiresOnboarding) {
          navigate({ to: "/", replace: true });
          return;
        }
        setUser(me.user);
        setClasses(options.classes);
        const profile = me.user.profile || {};
        setValues({
          preferredName: profile.preferredName || me.user.fullName || "",
          collegeId: profile.collegeId || "",
          program: profile.program || "",
          rollNumber: profile.rollNumber || "",
          yearOfStudy: profile.yearOfStudy ? String(profile.yearOfStudy) : "",
          admissionYear: profile.admissionYear ? String(profile.admissionYear) : "",
          expectedGraduationYear: profile.expectedGraduationYear
            ? String(profile.expectedGraduationYear)
            : "",
          academicClassId: "",
          phone: profile.phone || "",
          bio: profile.bio || "",
          skills: (profile.skills || []).join(", "),
          interests: (profile.interests || []).join(", "),
          achievements: (profile.achievements || []).join(", "),
          linkedinUrl: profile.linkedinUrl || "",
          githubUrl: profile.githubUrl || "",
          portfolioUrl: profile.portfolioUrl || "",
        });
      })
      .catch((err: unknown) => {
        if (alive)
          setError(err instanceof Error ? err.message : "Could not load registration details");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [navigate]);

  const selectedClass = useMemo(
    () => classes.find((item) => item.id === values.academicClassId),
    [classes, values.academicClassId],
  );
  const update = (key: FormKey, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const field = (key: FormKey, label: string, required = false, type = "text") => (
    <label className="block" key={key}>
      <span className={labelClass}>
        {label}
        {required ? " *" : ""}
      </span>
      <input
        className={inputClass}
        type={type}
        required={required}
        maxLength={key === "bio" ? 500 : 160}
        value={values[key] || ""}
        onChange={(e) => update(key, e.target.value)}
      />
    </label>
  );

  const validateStep = () => {
    if (step === 0 && !values.preferredName?.trim()) {
      setError("Enter the name you want displayed in Snippet.");
      return false;
    }
    if (
      step === 1 &&
      (!values.collegeId?.trim() ||
        !values.program?.trim() ||
        !values.rollNumber?.trim() ||
        !values.yearOfStudy ||
        !values.admissionYear ||
        !values.expectedGraduationYear ||
        !values.academicClassId)
    ) {
      setError("Complete all required academic fields before continuing.");
      return false;
    }
    if (step === 1 && Number(values.expectedGraduationYear) < Number(values.admissionYear)) {
      setError("Expected graduation year must be after admission year.");
      return false;
    }
    setError("");
    return true;
  };

  const submit = async () => {
    if (!validateStep()) return;
    setSaving(true);
    setError("");
    const list = (key: FormKey) =>
      (values[key] || "")
        .split(",")
        .map((item: string) => item.trim())
        .filter(Boolean);
    try {
      const result = await api<{
        user: User;
        accessToken: string;
        refreshToken: string;
        requiresOnboarding: boolean;
      }>("/auth/complete-profile", {
        method: "POST",
        body: {
          preferredName: values.preferredName,
          collegeId: values.collegeId,
          program: values.program,
          rollNumber: values.rollNumber,
          yearOfStudy: Number(values.yearOfStudy),
          admissionYear: Number(values.admissionYear),
          expectedGraduationYear: Number(values.expectedGraduationYear),
          academicClassId: values.academicClassId,
          phone: values.phone,
          bio: values.bio,
          skills: list("skills"),
          interests: list("interests"),
          achievements: list("achievements"),
          linkedinUrl: values.linkedinUrl,
          githubUrl: values.githubUrl,
          portfolioUrl: values.portfolioUrl,
        },
      });
      setTokens(result.accessToken, result.refreshToken);
      setStoredUser(result.user);
      navigate({ to: "/", replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save your profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <AppShell>
        <p className="py-12 text-center text-sm text-muted-foreground">Loading registration…</p>
      </AppShell>
    );
  if (!user)
    return (
      <AppShell>
        <div className="py-12 text-center">
          <p className="text-sm text-destructive">{error || "Your session could not be loaded."}</p>
          <button
            className="mt-4 underline"
            onClick={() => {
              clearTokens();
              navigate({ to: "/auth" });
            }}
          >
            Sign in again
          </button>
        </div>
      </AppShell>
    );

  const headings = ["Account", "Academic details", "About you", "Review"];
  return (
    <AppShell>
      <div className="mx-auto max-w-xl py-6">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Spark className="text-primary-deep" /> Student registration
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Complete your profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Step {step + 1} of 4 · {headings[step]}
        </p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(step + 1) * 25}%` }}
          />
        </div>

        <section className="surface mt-6 space-y-4 rounded-[24px] p-5">
          {step === 0 && (
            <>
              {user.profile?.googlePictureUrl && (
                <img
                  src={user.profile.googlePictureUrl}
                  alt="Google profile"
                  width={64}
                  height={64}
                  className="h-16 w-16 rounded-full object-cover"
                />
              )}
              {field("preferredName", "Name shown in Snippet", true)}
              <label className="block">
                <span className={labelClass}>Verified college email</span>
                <input className={`${inputClass} opacity-70`} value={user.email} readOnly />
              </label>
              <p className="text-xs text-muted-foreground">
                Your Google profile photo is used when available. Profile photo uploads are not
                enabled yet.
              </p>
            </>
          )}
          {step === 1 && (
            <>
              {field("collegeId", "College ID / PRN (self-reported)", true)}
              {field("program", "Program", true)}
              {field("rollNumber", "Roll number", true)}
              <div className="grid grid-cols-2 gap-3">
                {field("yearOfStudy", "Study year", true, "number")}
                {field("admissionYear", "Admission year", true, "number")}
              </div>
              {field("expectedGraduationYear", "Expected graduation year", true, "number")}
              <label className="block">
                <span className={labelClass}>Branch, batch, division and semester *</span>
                <select
                  className={inputClass}
                  required
                  value={values.academicClassId || ""}
                  onChange={(e) => update("academicClassId", e.target.value)}
                >
                  <option value="">Select configured class</option>
                  {classes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.branch_name} ({item.branch_code}) · {item.start_year}–{item.end_year} ·{" "}
                      {item.division_name} · Semester {item.semester_number}
                    </option>
                  ))}
                </select>
              </label>
              {selectedClass && (
                <p className="text-xs text-muted-foreground">
                  Class assignment uses the administrator-configured academic hierarchy.
                </p>
              )}
            </>
          )}
          {step === 2 && (
            <>
              {field("phone", "Phone (optional)", false, "tel")}
              <label className="block">
                <span className={labelClass}>Short bio</span>
                <textarea
                  className={inputClass}
                  rows={3}
                  maxLength={500}
                  value={values.bio || ""}
                  onChange={(e) => update("bio", e.target.value)}
                />
              </label>
              {field("skills", "Skills (comma separated)")}
              {field("interests", "Interests (comma separated)")}
              {field("achievements", "Achievements (comma separated)")}
              {field("linkedinUrl", "LinkedIn URL", false, "url")}
              {field("githubUrl", "GitHub URL", false, "url")}
              {field("portfolioUrl", "Portfolio URL", false, "url")}
            </>
          )}
          {step === 3 && (
            <div className="space-y-3 text-sm">
              <p>
                <strong>Name:</strong> {values.preferredName}
              </p>
              <p>
                <strong>College email:</strong> {user.email}
              </p>
              <p>
                <strong>College ID / PRN:</strong> {values.collegeId}{" "}
                <span className="text-xs text-muted-foreground">(self-reported)</span>
              </p>
              <p>
                <strong>Program / branch:</strong> {values.program} /{" "}
                {selectedClass?.branch_name || "—"}
              </p>
              <p>
                <strong>Roll / study year:</strong> {values.rollNumber} / {values.yearOfStudy}
              </p>
              <p>
                <strong>Admission / expected graduation:</strong> {values.admissionYear} /{" "}
                {values.expectedGraduationYear}
              </p>
              <p>
                <strong>Class:</strong>{" "}
                {selectedClass
                  ? `${selectedClass.start_year}–${selectedClass.end_year}, ${selectedClass.division_name}, semester ${selectedClass.semester_number}`
                  : "—"}
              </p>
              <p className="pt-2 text-xs text-muted-foreground">
                You can edit optional profile details later. Your email, role, and class assignment
                are controlled by account and academic records.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setStep((current) => current - 1);
                }}
                className="press flex-1 rounded-2xl border border-border py-3 text-sm font-semibold"
              >
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={() => {
                  if (validateStep()) setStep((current) => current + 1);
                }}
                className="press flex-1 rounded-2xl bg-foreground py-3 text-sm font-semibold text-background"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit()}
                className="press flex-1 rounded-2xl bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-50"
              >
                {saving ? "Saving…" : "Complete registration"}
              </button>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
