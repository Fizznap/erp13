import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FacultyManagement } from "@/routes/_authenticated/admin/faculty";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: any) => ({
    ...config,
    component: config.component,
  }),
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: () => "/admin/faculty",
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/snippet/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/hooks/use-auth", () => ({
  useMe: () => ({
    me: {
      id: "admin-1",
      email: "admin@ustu.edu.in",
      name: "Admin User",
      role: "admin",
      isAdmin: true,
    },
    loading: false,
  }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(),
    fetchSubjects: vi.fn(),
  };
});

import { api, fetchSubjects } from "@/lib/api";

describe("Admin FacultyManagement Component", () => {
  let queryClient: QueryClient;

  const mockFacultyUsers = [
    {
      id: "fac-1",
      email: "ada.lovelace@ustu.edu.in",
      full_name: "Dr. Ada Lovelace",
      role: "faculty",
      is_active: true,
      email_verified: true,
      created_at: new Date().toISOString(),
    },
  ];

  const mockSubjects = [
    {
      id: "subj-1",
      name: "Computer Networks",
      code: "CS401",
      offering_id: "offering-cs401",
      division_name: "B",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.mocked(fetchSubjects).mockResolvedValue(mockSubjects as any);
    vi.mocked(api).mockImplementation(async (endpoint: string, options?: any) => {
      if (endpoint === "/admin/users") {
        return { users: mockFacultyUsers } as any;
      }
      if (endpoint === "/admin/faculty" && options?.method === "POST") {
        const body = options.body;
        return {
          message: "Faculty created successfully",
          faculty: {
            id: "fac-new",
            email: body.email,
            full_name: body.fullName,
            role: "faculty",
            is_active: true,
            email_verified: true,
          },
        } as any;
      }
      return {} as any;
    });
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <FacultyManagement />
      </QueryClientProvider>,
    );
  };

  it("1. Renders faculty member list", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Dr. Ada Lovelace")).toBeInTheDocument();
      expect(screen.getByText("ada.lovelace@ustu.edu.in")).toBeInTheDocument();
    });
  });

  it("2. Opens modal and successfully creates a new faculty member with subject assignment", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Dr. Ada Lovelace")).toBeInTheDocument();
    });

    // Click "Add Faculty Member" button
    const addBtn = screen.getByRole("button", { name: "Add Faculty Member" });
    fireEvent.click(addBtn);

    // Modal should be open
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Add Faculty Member" })).toBeInTheDocument();
    });

    // Fill form fields
    const nameInput = screen.getByPlaceholderText(/e\.g\. Dr\. Alan Turing/i);
    const emailInput = screen.getByPlaceholderText(/e\.g\. alan\.turing@ustu\.edu\.in/i);
    const passwordInput = screen.getByPlaceholderText("••••••••");

    fireEvent.change(nameInput, { target: { value: "Dr. Alan Turing" } });
    fireEvent.change(emailInput, { target: { value: "alan.turing@ustu.edu.in" } });
    fireEvent.change(passwordInput, { target: { value: "securePass123" } });

    // Submit form
    const submitBtn = screen.getByRole("button", { name: "Create Faculty" });
    fireEvent.click(submitBtn);

    // Verify API call
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/admin/faculty",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            fullName: "Dr. Alan Turing",
            email: "alan.turing@ustu.edu.in",
            password: "securePass123",
          }),
        }),
      );
    });

    // Verify success banner appears
    await waitFor(() => {
      expect(
        screen.getByText(/Faculty account created for Dr\. Alan Turing \(alan\.turing@ustu\.edu\.in\)!/i),
      ).toBeInTheDocument();
    });
  });
});
