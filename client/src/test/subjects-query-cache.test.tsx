import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fetchSubjects, SUBJECTS_QUERY_KEY, type Subject } from "@/lib/api";

// Mock @tanstack/react-router components
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: any) => ({
    ...config,
    options: config,
  }),
  Link: ({ children, to, ...props }: any) => (
    <a href={typeof to === "string" ? to : "#"} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ navigate: vi.fn() }),
}));

// Mock useMe hook
vi.mock("@/hooks/use-auth", () => ({
  useMe: () => ({
    me: {
      name: "Alex Rivera",
      isFaculty: false,
      isAdmin: false,
      user: { id: "u-1", email: "alex@college.edu", fullName: "Alex Rivera", role: "student" },
    },
    loading: false,
    reload: vi.fn(),
  }),
}));

// Mock AppShell to keep tests lightweight
vi.mock("@/components/snippet/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  Progress: () => <div />,
  Spark: () => <span />,
}));

// Import route definitions after mocks
import { Route as SubjectsRoute } from "@/routes/_authenticated/subjects.index";
import { Route as ResourcesRoute } from "@/routes/_authenticated/resources";

const mockSubjectData: Subject[] = [
  {
    id: "sub-101",
    name: "Operating Systems",
    code: "CS301",
    offering_id: "off-101",
    faculty_name: "Dr. Alan Turing",
  },
  {
    id: "sub-102",
    name: "Database Systems",
    code: "CS302",
    offering_id: "off-102",
    faculty_name: "Dr. Edgar Codd",
  },
];

describe("Shared Subjects Query Cache & Normalization", () => {
  let queryClient: QueryClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
        },
      },
    });
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function setupFetchMock(mockResponse: { ok: boolean; status?: number; data: unknown }) {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/subjects")) {
        return Promise.resolve({
          ok: mockResponse.ok,
          status: mockResponse.status ?? (mockResponse.ok ? 200 : 500),
          json: () => Promise.resolve(mockResponse.data),
        } as Response);
      }
      if (url.includes("/resources")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ resources: [] }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      } as Response);
    });
  }

  // Component mimicking StudentHome subjects query on the dashboard
  function DashboardSubjectsConsumer() {
    const { data } = useQuery({
      queryKey: SUBJECTS_QUERY_KEY,
      queryFn: fetchSubjects,
    });
    return (
      <div data-testid="dashboard">
        <span data-testid="subject-count">{data ? `${data.length} assigned subjects` : "Loading..."}</span>
      </div>
    );
  }

  it("1. The dashboard caches a Subject[], not the full API response object", async () => {
    setupFetchMock({
      ok: true,
      data: { subjects: mockSubjectData },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <DashboardSubjectsConsumer />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("subject-count")).toHaveTextContent("2 assigned subjects");
    });

    const cached = queryClient.getQueryData<unknown>(SUBJECTS_QUERY_KEY);
    // Cached data MUST be an array directly, NOT { subjects: [...] }
    expect(Array.isArray(cached)).toBe(true);
    expect(cached).toEqual(mockSubjectData);
    expect(cached).not.toHaveProperty("subjects");
  });

  it("2. Navigating from the dashboard to /subjects renders subject cards correctly using shared cache", async () => {
    setupFetchMock({
      ok: true,
      data: { subjects: mockSubjectData },
    });

    // 1. First, dashboard loads and caches subjects
    const { unmount: unmountDashboard } = render(
      <QueryClientProvider client={queryClient}>
        <DashboardSubjectsConsumer />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("subject-count")).toHaveTextContent("2 assigned subjects");
    });
    unmountDashboard();

    // 2. Navigate to /subjects with the same QueryClient (shared cache)
    const SubjectsComponent = (SubjectsRoute as any).component;
    render(
      <QueryClientProvider client={queryClient}>
        <SubjectsComponent />
      </QueryClientProvider>
    );

    // Should immediately render subject cards from cache without errors
    expect(screen.getByText("Operating Systems")).toBeInTheDocument();
    expect(screen.getByText("CS301")).toBeInTheDocument();
    expect(screen.getByText("Database Systems")).toBeInTheDocument();
    expect(screen.getByText("CS302")).toBeInTheDocument();
  });

  it("3. Navigating from the dashboard to /resources does not produce a .map is not a function error", async () => {
    setupFetchMock({
      ok: true,
      data: { subjects: mockSubjectData },
    });

    // 1. Dashboard runs and caches data under ["subjects"]
    const { unmount: unmountDashboard } = render(
      <QueryClientProvider client={queryClient}>
        <DashboardSubjectsConsumer />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("subject-count")).toHaveTextContent("2 assigned subjects");
    });
    unmountDashboard();

    // 2. Navigate to /resources with the same shared QueryClient
    const ResourcesComponent = (ResourcesRoute as any).component;
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    // Verify select dropdown rendered and options exist without .map crash
    await waitFor(() => {
      const select = container.querySelector("select");
      expect(select).not.toBeNull();
      expect(screen.getByText("Operating Systems (CS301)")).toBeInTheDocument();
      expect(screen.getByText("Database Systems (CS302)")).toBeInTheDocument();
    });
  });

  it("4. Loading does not cause a .map() exception", async () => {
    // Keep fetch pending to test initial loading state
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    const ResourcesComponent = (ResourcesRoute as any).component;
    render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    // Displays loading indicator, does not call .map on undefined data or throw
    expect(screen.getByText("Loading subjects…")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("5. An empty subjects array displays the correct empty state", async () => {
    setupFetchMock({
      ok: true,
      data: { subjects: [] },
    });

    const ResourcesComponent = (ResourcesRoute as any).component;
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("No subjects have been assigned to your class yet.")).toBeInTheDocument();
    });
    // Dropdown should not be rendered
    expect(screen.queryByRole("combobox")).toBeNull();
    unmount();

    // Check Subjects page also displays empty state
    const SubjectsComponent = (SubjectsRoute as any).component;
    render(
      <QueryClientProvider client={queryClient}>
        <SubjectsComponent />
      </QueryClientProvider>
    );

    expect(screen.getByText("No subjects have been assigned to your class yet.")).toBeInTheDocument();
  });

  it("6. An API error is not incorrectly represented as an empty list", async () => {
    setupFetchMock({
      ok: false,
      status: 500,
      data: { error: "Internal Server Error" },
    });

    const ResourcesComponent = (ResourcesRoute as any).component;
    render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    await waitFor(() => {
      // Must display the error state, NOT the empty list message
      expect(screen.getByText("Could not load your subjects. Please try again.")).toBeInTheDocument();
    });

    expect(screen.queryByText("No subjects have been assigned to your class yet.")).toBeNull();
    // Cache must not be set to []
    const cached = queryClient.getQueryData(SUBJECTS_QUERY_KEY);
    expect(cached).toBeUndefined();
  });

  describe("7. Malformed API responses are handled safely", () => {
    const malformedCases = [
      { name: "null response", payload: null },
      { name: "missing subjects key", payload: { classes: [] } },
      { name: "subjects is not an array (string)", payload: { subjects: "not-an-array" } },
      { name: "subjects is null", payload: { subjects: null } },
      { name: "non-object string response", payload: "invalid json string" },
    ];

    malformedCases.forEach(({ name, payload }) => {
      it(`handles malformed response: ${name}`, async () => {
        setupFetchMock({
          ok: true,
          data: payload,
        });

        // 1. fetchSubjects directly rejects with descriptive error
        await expect(fetchSubjects()).rejects.toThrow(/Malformed subjects API response/);

        // 2. Resources page enters error state and does not crash with .map is not a function
        const freshQueryClient = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });

        const ResourcesComponent = (ResourcesRoute as any).component;
        render(
          <QueryClientProvider client={freshQueryClient}>
            <ResourcesComponent />
          </QueryClientProvider>
        );

        await waitFor(() => {
          expect(screen.getByText("Could not load your subjects. Please try again.")).toBeInTheDocument();
        });
        expect(screen.queryByText("No subjects have been assigned to your class yet.")).toBeNull();
      });
    });
  });

  it("reproduces full navigation sequence: / -> /subjects -> /resources without errors", async () => {
    setupFetchMock({
      ok: true,
      data: { subjects: mockSubjectData },
    });

    const consoleErrorSpy = vi.spyOn(console, "error");

    // 1. Open / (dashboard)
    const { unmount: unmountDash } = render(
      <QueryClientProvider client={queryClient}>
        <DashboardSubjectsConsumer />
      </QueryClientProvider>
    );

    // 2. Wait for the dashboard subjects query to complete
    await waitFor(() => {
      expect(screen.getByTestId("subject-count")).toHaveTextContent("2 assigned subjects");
    });
    unmountDash();

    // 3. Navigate to /subjects
    const SubjectsComponent = (SubjectsRoute as any).component;
    const { unmount: unmountSubj } = render(
      <QueryClientProvider client={queryClient}>
        <SubjectsComponent />
      </QueryClientProvider>
    );

    // 4. Verify that subjects render
    expect(screen.getByText("Operating Systems")).toBeInTheDocument();
    expect(screen.getByText("Database Systems")).toBeInTheDocument();
    unmountSubj();

    // 5. Navigate to /resources
    const ResourcesComponent = (ResourcesRoute as any).component;
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    // 6. Verify that the page renders without runtime errors (.map is not a function)
    await waitFor(() => {
      const select = container.querySelector("select");
      expect(select).not.toBeNull();
      expect(screen.getByText("Operating Systems (CS301)")).toBeInTheDocument();
      expect(screen.getByText("Database Systems (CS302)")).toBeInTheDocument();
    });

    // Verify no uncaught .map or query error was logged to console
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/\.map is not a function|Uncaught/i)
    );
  });
});

