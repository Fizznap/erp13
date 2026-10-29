import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/hooks/use-auth", () => ({
  useMe: () => ({
    me: {
      id: "admin-1",
      email: "admin@ustu.edu.in",
      role: "admin",
      isAdmin: true,
      fullName: "Admin User",
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
import { ResultsManagement } from "@/routes/_authenticated/admin/results";

describe("Admin ResultsManagement Component", () => {
  let queryClient: QueryClient;

  const mockOverview = {
    results: [
      {
        id: "res-1",
        studentId: "stud-1",
        studentName: "Viraj Mengeri",
        rollNumber: "UST24R0102086",
        subjectId: "subj-1",
        subjectName: "Computer Networks",
        subjectCode: "CS401",
        totalMarks: 92,
        grade: "O",
        gradePoints: 10,
        credits: 4,
        status: "published",
        academicYear: 2024,
      },
    ],
    count: 1,
    totalCount: 1,
    publishedCount: 1,
    draftCount: 0,
    withheldCount: 0,
  };

  const mockHierarchy = {
    classes: [
      {
        id: "class-1",
        branch_code: "CSE",
        start_year: 2024,
        end_year: 2028,
        division_name: "A",
        semester_number: 4,
      },
    ],
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    });

    vi.mocked(api).mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith("/results") || endpoint.startsWith("/api/results")) {
        return mockOverview;
      }
      if (endpoint === "/academic/hierarchy" || endpoint === "/api/academic/hierarchy") {
        return mockHierarchy;
      }
      return {};
    });

    vi.mocked(fetchSubjects).mockResolvedValue([
      {
        id: "subj-1",
        name: "Computer Networks",
        code: "CS401",
      } as any,
    ]);
  });

  it("renders the results overview with metrics cards and actions", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ResultsManagement />
      </QueryClientProvider>
    );

    expect(screen.getByText("Academic Results")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Add Result/i }).length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText("Viraj Mengeri")).toBeInTheDocument();
      expect(screen.getByText(/Computer Networks/)).toBeInTheDocument();
      expect(screen.getByText("UST24R0102086")).toBeInTheDocument();
    });
  });

  it("opens the Add Result modal when button is clicked", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ResultsManagement />
      </QueryClientProvider>
    );

    const addButtons = screen.getAllByRole("button", { name: /Add Result/i });
    fireEvent.click(addButtons[0]);

    expect(screen.getByText("Add Academic Result")).toBeInTheDocument();
    expect(screen.getByText("-- Select Student --")).toBeInTheDocument();
    expect(screen.getByText("-- Select Class --")).toBeInTheDocument();
  });
});
