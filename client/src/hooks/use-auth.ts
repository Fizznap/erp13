import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, clearTokens } from "@/lib/api";

export type SnippetUser = { 
  id: string; 
  email: string; 
  fullName: string; 
  role: string; 
  isActive: boolean; 
  createdAt: string; 
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

  const load = async () => {
    try {
      const data = await api<{user: SnippetUser}>('/auth/me');
      const user = data.user;
      
      const isFaculty = user.role === 'faculty';
      const isAdmin = user.role === 'admin';
      setMe({
        user,
        name: user.fullName || user.email.split("@")[0] || "",
        isFaculty,
        isAdmin,
        needsSetup: false, // Could be fetched from a specific endpoint if we need to know if they joined a class
        avatar: null,
        subtitle: isFaculty ? "Faculty" : "Student",
      });
    } catch (err) {
      setMe(null);
      clearTokens();
      qc.removeQueries();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return { me, loading, reload: load };
}
