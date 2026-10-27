import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SnippetUser } from "@/hooks/use-auth";
import { useAvatarUrl } from "@/lib/avatar";
import { Camera, Trash2 } from "lucide-react";

export function ProfileForm({
  user,
  onSaved,
}: {
  user: SnippetUser | undefined;
  onSaved?: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const profile = user?.profile;
  const photoPath = profile?.hasUploadedPhoto
    ? `snippet-upload:${profile.avatarUpdatedAt || "latest"}`
    : profile?.googlePictureUrl;
  const photoUrl = useAvatarUrl(photoPath);

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const uploadPhoto = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMsg("Choose an image that is 2 MB or smaller.");
      return;
    }
    setPhotoLoading(true);
    setMsg("");
    try {
      const body = new FormData();
      body.append("file", file);
      await api("/auth/avatar", { method: "PUT", body });
      setPhotoPreview(null);
      await onSaved?.();
      setMsg("Profile photo updated.");
    } catch (err: unknown) {
      setPhotoPreview(null);
      setMsg(err instanceof Error ? err.message : "Could not upload profile photo");
    } finally {
      setPhotoLoading(false);
    }
  };

  const removePhoto = async () => {
    setPhotoLoading(true);
    setMsg("");
    try {
      await api("/auth/avatar", { method: "DELETE" });
      setPhotoPreview(null);
      await onSaved?.();
      setMsg("Uploaded photo removed.");
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : "Could not remove profile photo");
    } finally {
      setPhotoLoading(false);
    }
  };

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
      yearOfStudy: data.get("yearOfStudy"),
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
      <div className="flex items-center gap-4 rounded-2xl bg-muted/40 p-4">
        {photoPreview || photoUrl ? (
          <img
            src={photoPreview || photoUrl || undefined}
            alt="Profile"
            className="h-16 w-16 rounded-full object-cover"
          />
        ) : (
          <div className="grid h-16 w-16 place-items-center rounded-full bg-muted text-muted-foreground">
            <Camera className="h-6 w-6" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Profile photo</p>
          <p className="mt-0.5 text-xs text-muted-foreground">JPEG, PNG, or WebP · up to 2 MB</p>
          <label className="press mt-2 inline-flex cursor-pointer items-center rounded-full bg-card px-3 py-1.5 text-xs font-semibold">
            {photoLoading ? "Saving…" : "Upload photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={photoLoading}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  setPhotoPreview(URL.createObjectURL(file));
                  void uploadPhoto(file);
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
          {profile?.hasUploadedPhoto && (
            <button
              type="button"
              disabled={photoLoading}
              onClick={removePhoto}
              className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs text-muted-foreground disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </div>
      </div>
      {msg && (
        <div role="status" className="text-sm text-primary-deep">
          {msg}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {textInput("fullName", "Account name", user?.fullName)}
        {textInput("preferredName", "Name shown in Snippet", profile?.preferredName)}
        {textInput("yearOfStudy", "Study year", profile?.yearOfStudy, "number")}
        {textInput(
          "expectedGraduationYear",
          "Expected graduation year",
          profile?.expectedGraduationYear,
          "number",
        )}
        {textInput("phone", "Phone", profile?.phone, "tel")}
      </div>
      <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
        College email: {user?.email || "—"} · Roll number / PRN:{" "}
        {profile?.rollNumber || profile?.collegeId || "—"} · Program / branch:{" "}
        {profile?.program || "B.Tech"} / {profile?.branchName || "—"} · Admission batch:{" "}
        {profile?.admissionYear || "—"}. These academic identifiers are set during registration;
        contact an administrator if they need correction.
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
