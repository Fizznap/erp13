import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const token = localStorage.getItem('snippet_token');
    if (!token) throw redirect({ to: "/auth" });
    try {
      const payload = JSON.parse(atob(token!.split('.')[1] || ""));
      return { user: { id: payload.id, email: payload.email, role: payload.role } };
    } catch {
      throw redirect({ to: "/auth" });
    }
  },
  component: () => <Outlet />,
});
