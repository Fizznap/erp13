import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudentAcademics } from "@/components/snippet/StudentAcademics";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(),
  };
});

vi.mock("@/hooks/use-auth", () => ({
  useMe: () => ({
    me: {
      id: "student-1",
      email: "smit.haria@ustu.edu.in",
      name: "Smit Haria",
      role: "student",
      isFaculty: false,
    },
    loading: false,
  }),
}));

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
  useRouterState: () => "/",
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/snippet/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { api } from "@/lib/api";

describe("StudentAcademics Component", () => {
  let queryClient: QueryClient;

  const mockAttendanceOverview = {
    semesters: [
      {
        semesterNumber: 5,
        academicClassId: "class-sem5",
        label: "Semester V (2024–28)",
        isCurrent: true,
      },
    ],
    selectedSemester: 5,
    overall: {
      percentage: 80.28,
      attended: 114,
      total: 142,
    },
    subjects: [
      {
        offeringId: "off-cs501",
        subjectId: "subj-cs501",
        name: "Operating Systems",
        code: "CS501",
        isLab: false,
        facultyName: "Dr. Andrew Tanenbaum",
        attended: 24,
        total: 28,
        percentage: 85.71,
      },
      {
        offeringId: "off-cs501l",
        subjectId: "subj-cs501l",
        name: "Operating Systems Lab",
        code: "CS501L",
        isLab: true,
        facultyName: "Dr. Andrew Tanenbaum",
        attended: 14,
        total: 14,
        percentage: 100,
      },
    ],
  };

  const mockResultsPayload = {
    results: [
      {
        id: "res-1",
        studentId: "student-1",
        subjectId: "subj-cs501",
        academicClassId: "class-sem5",
        subjectName: "Operating Systems",
        subjectCode: "CS501",
        internalMarks: 27,
        externalMarks: 65,
        totalMarks: 92,
        grade: "O",
        gradePoints: 10,
        credits: 4,
        status: "published",
        examType: "regular",
        academicYear: 2024,
        isSynthetic: false,
      },
      {
        id: "res-2",
        studentId: "student-1",
        subjectId: "subj-cs501l",
        academicClassId: "class-sem5",
        subjectName: "Operating Systems Lab",
        subjectCode: "CS501L",
        internalMarks: 24,
        externalMarks: 24,
        totalMarks: 48,
        grade: "A+",
        gradePoints: 9,
        credits: 2,
        status: "published",
        examType: "regular",
        academicYear: 2024,
        isSynthetic: false,
      },
    ],
    terms: [
      {
        termId: "term-sem5",
        termTitle: "ODD Term AY 2024–25",
        semesterNumber: 5,
        academicYear: 2024,
        batch: "2024–28",
        divisionName: "B",
        branchCode: "CSE",
        declarationDate: "2025-01-15T00:00:00.000Z",
        status: "published",
        sgpa: "9.67",
        earnedCredits: 6,
        totalCourses: 2,
        results: [
          {
            id: "res-1",
            studentId: "student-1",
            subjectId: "subj-cs501",
            academicClassId: "class-sem5",
            subjectName: "Operating Systems",
            subjectCode: "CS501",
            internalMarks: 27,
            externalMarks: 65,
            totalMarks: 92,
            grade: "O",
            gradePoints: 10,
            credits: 4,
            status: "published",
            examType: "regular",
            academicYear: 2024,
            isSynthetic: false,
          },
          {
            id: "res-2",
            studentId: "student-1",
            subjectId: "subj-cs501l",
            academicClassId: "class-sem5",
            subjectName: "Operating Systems Lab",
            subjectCode: "CS501L",
            internalMarks: 24,
            externalMarks: 24,
            totalMarks: 48,
            grade: "A+",
            gradePoints: 9,
            credits: 2,
            status: "published",
            examType: "regular",
            academicYear: 2024,
            isSynthetic: false,
          },
        ],
      },
    ],
    summary: {
      totalResults: 2,
      totalCredits: 6,
      cgpa: "9.67",
      declaredTermsCount: 1,
      pendingTermsCount: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    vi.mocked(api).mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith("/attendance/my/overview")) {
        return mockAttendanceOverview as any;
      }
      if (endpoint.startsWith("/results/student/")) {
        return mockResultsPayload as any;
      }
      if (endpoint === "/attendance/my/records") {
        return { records: [] } as any;
      }
      return {} as any;
    });
  });

  const renderComponent = (initialTab: "currentTerm" | "examResults" = "currentTerm") => {
    return render(
      <QueryClientProvider client={queryClient}>
        <StudentAcademics initialTab={initialTab} />
      </QueryClientProvider>,
    );
  };

  it("1. Renders Current Term attendance breakdown with circular progress and subject cards", async () => {
    renderComponent("currentTerm");

    await waitFor(() => {
      expect(screen.getByText("80.28%")).toBeInTheDocument();
      expect(screen.getByText("114 of 142 sessions attended")).toBeInTheDocument();
    });

    // Check subjects
    expect(screen.getByText("Operating Systems")).toBeInTheDocument();
    expect(screen.getByText("CS501")).toBeInTheDocument();
    expect(screen.getByText("24 / 28 sessions")).toBeInTheDocument();

    // Check Lab offering with lab badge
    expect(screen.getByText("Operating Systems Lab")).toBeInTheDocument();
    expect(screen.getByText("LAB")).toBeInTheDocument();
    expect(screen.getByText("14 / 14 sessions")).toBeInTheDocument();

    // Check Quick mark attendance section
    expect(screen.getByText("Submit Live Attendance")).toBeInTheDocument();
  });

  it("2. Renders Exam Results tab, terms summary, and supports drilldown into individual term", async () => {
    renderComponent("examResults");

    await waitFor(() => {
      expect(screen.getByText("9.67 CGPA")).toBeInTheDocument();
      expect(screen.getByText(/6 Total Earned Credits/i)).toBeInTheDocument();
      expect(screen.getByText("ODD Term AY 2024–25")).toBeInTheDocument();
    });

    // Click on the declared term card to drill down
    const termCard = screen.getByText("ODD Term AY 2024–25");
    fireEvent.click(termCard);

    // Verify drilldown into term
    await waitFor(() => {
      expect(screen.getByText("9.67 SGPA")).toBeInTheDocument();
      expect(screen.getByText(/6 Earned Credits · 2 Courses Evaluated/i)).toBeInTheDocument();
      expect(screen.getByText("Back to All Terms")).toBeInTheDocument();
    });

    // Verify course evaluations and grade badges
    expect(screen.getByText("CS501")).toBeInTheDocument();
    expect(screen.getByText("92/100")).toBeInTheDocument();
    expect(screen.getByText("O")).toBeInTheDocument();

    expect(screen.getByText("CS501L")).toBeInTheDocument();
    expect(screen.getByText("48/100")).toBeInTheDocument();
    expect(screen.getByText("A+")).toBeInTheDocument();

    // Click back to all terms
    const backBtn = screen.getByRole("button", { name: /Back to All Terms/i });
    fireEvent.click(backBtn);

    await waitFor(() => {
      expect(screen.getByText("Declared Academic Terms")).toBeInTheDocument();
    });
  });

  it("3. Allows toggling between Current Term and Exam Results tabs", async () => {
    renderComponent("currentTerm");

    await waitFor(() => {
      expect(screen.getByText("80.28%")).toBeInTheDocument();
    });

    // Click Exam Results button
    const examResultsTab = screen.getByRole("button", { name: /Exam Results/i });
    fireEvent.click(examResultsTab);

    await waitFor(() => {
      expect(screen.getByText("9.67 CGPA")).toBeInTheDocument();
    });

    // Click Current Term button
    const currentTermTab = screen.getByRole("button", { name: /Current Term/i });
    fireEvent.click(currentTermTab);

    await waitFor(() => {
      expect(screen.getByText("80.28%")).toBeInTheDocument();
    });
  });
});
