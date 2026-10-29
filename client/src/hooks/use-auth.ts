import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, clearTokens } from "@/lib/api";

export type StudentProfile = {
  googlePictureUrl: string | null;
  hasUploadedPhoto?: boolean;
  avatarUpdatedAt?: string | null;
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
  const qc = useQueryClient();
  const token = typeof window !== "undefined" ? localStorage.getItem("snippet_token") : null;

  const { data: me, isLoading, refetch } = useQuery<Me | null>({
    queryKey: ["auth-me", token],
    enabled: Boolean(token),
    staleTime: 60 * 1000,
    retry: false,
    queryFn: async () => {
      try {
        const data = await api<{ user: SnippetUser; requiresOnboarding?: boolean }>("/auth/me");
        const user = data.user;

        const isFaculty = user.role === "faculty";
        const isAdmin = user.role === "admin";
        return {
          user,
          name: user.profile?.preferredName || user.fullName || user.email.split("@")[0] || "",
          isFaculty,
          isAdmin,
          needsSetup: Boolean(data.requiresOnboarding),
          avatar: user.profile?.hasUploadedPhoto
            ? `snippet-upload:${user.profile.avatarUpdatedAt || "latest"}`
            : user.profile?.googlePictureUrl || null,
          subtitle: isFaculty ? "Faculty" : isAdmin ? "Admin" : "Student",
        };
      } catch (err) {
        clearTokens();
        qc.removeQueries();
        return null;
      }
    },
  });

  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return { me: me ?? null, loading: Boolean(token) && isLoading, reload };
}

