import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let mockUser: any = {
  id: "admin-1",
  email: "admin@ustu.edu.in",
  role: "admin",
  isAdmin: true,
  fullName: "Admin User",
};
let mockLoading = false;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: any) => ({
    ...config,
    component: config.component,
  }),
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
  useRouter: () => ({
    history: { back: vi.fn() },
  }),
}));

vi.mock("@/components/snippet/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

vi.mock("@/hooks/use-auth", () => ({
  useMe: () => ({
    me: mockUser,
    loading: mockLoading,
  }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(),
  };
});

import { api } from "@/lib/api";
import { AdminDashboard } from "@/routes/_authenticated/admin/index";

describe("AdminDashboard Component", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      id: "admin-1",
      email: "admin@ustu.edu.in",
      role: "admin",
      isAdmin: true,
      fullName: "Admin User",
    };
    mockLoading = false;

    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    });

    vi.mocked(api).mockResolvedValue({
      users: [],
      resources: [],
    });
  });

  it("renders loading state cleanly when loading is true", () => {
    mockLoading = true;
    render(
      <QueryClientProvider client={queryClient}>
        <AdminDashboard />
      </QueryClientProvider>
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders access denied when non-admin accesses", () => {
    mockUser = {
      id: "stud-1",
      email: "student@ustu.edu.in",
      role: "student",
      isAdmin: false,
    };
    render(
      <QueryClientProvider client={queryClient}>
        <AdminDashboard />
      </QueryClientProvider>
    );
    expect(screen.getByText("Only administrators can access this area.")).toBeInTheDocument();
  });

  it("renders dashboard safely without crashing when stats is still resolving", () => {
    vi.mocked(api).mockImplementation(() => new Promise(() => {}));

    render(
      <QueryClientProvider client={queryClient}>
        <AdminDashboard />
      </QueryClientProvider>
    );

    expect(screen.getByText("Admin Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Academic Results")).toBeInTheDocument();
    expect(screen.getByText("Student Management")).toBeInTheDocument();
    expect(screen.getByText("Faculty Accounts")).toBeInTheDocument();
  });

  it("renders live stats when api returns data", async () => {
    vi.mocked(api).mockResolvedValue({
      users: [
        { role: "student", count: "42" },
        { role: "faculty", count: "7" },
      ],
      subjects: 12,
      resources: [{ status: "ready", count: "15" }],
      queries: {
        total_queries: "100",
        found_count: "85",
        not_found_count: "15",
        avg_latency_ms: "250",
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AdminDashboard />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText("42").length).toBeGreaterThan(0);
      expect(screen.getAllByText("7").length).toBeGreaterThan(0);
      expect(screen.getByText("15")).toBeInTheDocument();
    });
  });

  it("displays error banner and retry button when stats fails", async () => {
    vi.mocked(api).mockRejectedValue(new Error("Database connection refused"));

    render(
      <QueryClientProvider client={queryClient}>
        <AdminDashboard />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Could not load institutional statistics.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });
  });
});
