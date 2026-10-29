import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminAttendance } from "@/components/snippet/AdminAttendance";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(),
    fetchSubjects: vi.fn(),
  };
});

import { api, fetchSubjects } from "@/lib/api";

describe("AdminAttendance Component", () => {
  let queryClient: QueryClient;

  const mockHierarchy = {
    classes: [
      {
        id: "class-1",
        branch_id: "branch-cse",
        batch_id: "batch-2024",
        division_id: "div-a",
        semester_id: "sem-4",
        branch_name: "Computer Science",
        branch_code: "CSE",
        start_year: 2024,
        end_year: 2028,
        division_name: "A",
        semester_number: 4,
      },
    ],
    labGroups: [
      {
        id: "group-1",
        branch_id: "branch-cse",
        batch_id: "batch-2024",
        division_id: "div-a",
        name: "L1",
      },
    ],
  };

  const mockSubjects = [
    {
      id: "subj-1",
      name: "Data Structures",
      code: "CS201",
      offering_id: "offering-1",
      academic_class_id: "class-1",
      faculty_name: "Dr. Grace Hopper",
      branch_id: "branch-cse",
      batch_id: "batch-2024",
      division_id: "div-a",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.mocked(fetchSubjects).mockResolvedValue(mockSubjects as any);
    vi.mocked(api).mockImplementation(async (endpoint: string, options?: any) => {
      if (endpoint === "/academic/hierarchy") {
        return mockHierarchy as any;
      }
      if (endpoint === "/attendance/start" && options?.method === "POST") {
        return {
          session: {
            id: "session-new-1",
            subject_offering_id: "offering-1",
            active_nonce: "7X8Y9Z",
            nonce_expires: new Date(Date.now() + 30000).toISOString(),
            is_active: true,
            started_at: new Date().toISOString(),
          },
        } as any;
      }
      if (endpoint.includes("/roster")) {
        return {
          students: [
            { student_id: "s-1", full_name: "Alice Smith", roll_number: "2024CSE001", status: "present", marked_at: new Date().toISOString() },
            { student_id: "s-2", full_name: "Bob Jones", roll_number: "2024CSE002", status: "absent", marked_at: null },
          ],
        } as any;
      }
      if (endpoint === "/attendance/session-new-1/end" && options?.method === "POST") {
        return { session: { id: "session-new-1", is_active: false } } as any;
      }
      if (endpoint.includes("/attendance/sessions")) {
        return { sessions: [] } as any;
      }
      return {} as any;
    });
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AdminAttendance />
      </QueryClientProvider>,
    );
  };

  it("1. Renders class and subject offering selection options", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Start Attendance Session" })).toBeInTheDocument();
    });

    // Check academic class option
    const classSelect = screen.getAllByRole("combobox")[0];
    expect(classSelect).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText(/CSE · Batch 2024 · Div A · Sem 4/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Data Structures \(CS201\) · Faculty: Dr. Grace Hopper/i),
      ).toBeInTheDocument();
    });
  });

  it("2. Allows starting an attendance session and displays the active 6-char code and roster", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Data Structures \(CS201\)/i)).toBeInTheDocument();
    });

    const selects = screen.getAllByRole("combobox");
    const classSelect = selects[0];
    const offeringSelect = selects[1];

    fireEvent.change(classSelect, { target: { value: "class-1" } });
    fireEvent.change(offeringSelect, { target: { value: "offering-1" } });

    const startBtn = screen.getByRole("button", { name: "Start Attendance Session" });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/attendance/start",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            subjectOfferingId: "offering-1",
            sessionType: "lecture",
          }),
        }),
      );
    });

    // Check active session banner and code
    await waitFor(() => {
      expect(screen.getByText("Live Session Active")).toBeInTheDocument();
      expect(screen.getByText("7X8Y9Z")).toBeInTheDocument();
      expect(screen.getByText(/Code rotates in/i)).toBeInTheDocument();
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
      expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    });

    // End session
    const endBtn = screen.getByRole("button", { name: /End Attendance Session/i });
    fireEvent.click(endBtn);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/attendance/session-new-1/end", { method: "POST" });
      expect(screen.getByText("Session Ended")).toBeInTheDocument();
    });
  });
});
