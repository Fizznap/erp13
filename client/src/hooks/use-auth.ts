import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, clearTokens } from "@/lib/api";

export type StudentProfile = {
  googlePictureUrl: string | null;
  preferredName: string | null;
  collegeId: string | null;
  program: string | null;
  rollNumber: string | null;
  yearOfStudy: number | null;
  admissionYear: number | null;
  expectedGraduationYear: number | null;
  phone: string | null;
  bio: string | null;
  skills: string[];
  interests: string[];
  achievements: string[];
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  branchName?: string | null;
  branchCode?: string | null;
  divisionName?: string | null;
  semesterNumber?: number | null;
  batchStartYear?: number | null;
  batchEndYear?: number | null;
};

export type SnippetUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  academicClassId?: string | null;
  profile?: StudentProfile;
  profileComplete?: boolean;
};

export type Me = {
  user: SnippetUser;
  name: string;
  isFaculty: boolean;
  isAdmin: boolean;
  avatar: string | null;
  subtitle: string;
  needsSetup: boolean;
};

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const load = useCallback(async () => {
    try {
      const data = await api<{ user: SnippetUser; requiresOnboarding?: boolean }>("/auth/me");
      const user = data.user;

      const isFaculty = user.role === "faculty";
      const isAdmin = user.role === "admin";
      setMe({
        user,
        name: user.profile?.preferredName || user.fullName || user.email.split("@")[0] || "",
        isFaculty,
        isAdmin,
        needsSetup: Boolean(data.requiresOnboarding),
        avatar: user.profile?.googlePictureUrl || null,
        subtitle: isFaculty ? "Faculty" : "Student",
      });
    } catch (err) {
      setMe(null);
      clearTokens();
      qc.removeQueries();
    } finally {
      setLoading(false);
    }
  }, [qc]);

  useEffect(() => {
    void load();
  }, [load]);

  return { me, loading, reload: load };
}
