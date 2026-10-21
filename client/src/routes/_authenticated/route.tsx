import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const token = localStorage.getItem("snippet_token");
    if (!token) throw redirect({ to: "/auth" });
    let data: { user: { id: string; email: string; role: string }; requiresOnboarding?: boolean };
    try {
      data = await api<{
        user: { id: string; email: string; role: string };
        requiresOnboarding?: boolean;
      }>("/auth/me");
    } catch {
      throw redirect({ to: "/auth" });
    }
    if (data.requiresOnboarding) throw redirect({ to: "/complete-profile" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});
