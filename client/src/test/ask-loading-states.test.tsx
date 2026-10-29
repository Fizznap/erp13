import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route } from "@/routes/_authenticated/ask";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: any) => ({
    ...config,
    component: config.component,
  }),
  useRouter: () => ({
    history: { back: vi.fn() },
  }),
}));

vi.mock("@/components/snippet/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
  Spark: () => <span />,
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

const AskComponent = Route.component as React.ComponentType;

describe("Ask Component — Loading, Summary, and Fallback states", () => {
  let queryClient: QueryClient;

  const mockSubjects = [
    {
      id: "sub-cn",
      name: "Computer Networks",
      code: "CN301",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.mocked(fetchSubjects).mockResolvedValue(mockSubjects as any);
  });

  it("1. Displays 'Snippet is thinking...' while waiting and does NOT show 'Not in provided material.' as placeholder", async () => {
    let resolveApi: (value: any) => void;
    const apiPromise = new Promise((resolve) => {
      resolveApi = resolve;
    });
    vi.mocked(api).mockReturnValue(apiPromise as any);

    render(
      <QueryClientProvider client={queryClient}>
        <AskComponent />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Computer Networks")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Ask about Computer Networks/i);
    fireEvent.change(input, { target: { value: "What this PDF consists ??" } });

    const submitBtn = screen.getByLabelText("Send");
    fireEvent.click(submitBtn);

    // Thinking indicator MUST be visible immediately
    expect(screen.getByText(/Snippet is thinking.../i)).toBeInTheDocument();
    // Fallback MUST NOT be visible while thinking
    expect(screen.queryByText(/Not in provided material./i)).not.toBeInTheDocument();

    // Now resolve the API with the grounded summary
    resolveApi!({
      answer: "Based on [1] **40192_Lab Manual_CN (1)-1.pdf**: Covers crimping tools and Linux networking commands.",
      sources: [{ filename: "40192_Lab Manual_CN (1)-1.pdf", pageNumber: 1 }],
      wasFound: true,
    });

    await waitFor(() => {
      expect(screen.getByText(/Based on \[1\]/i)).toBeInTheDocument();
    });

    // Thinking indicator is gone
    expect(screen.queryByText(/Snippet is thinking.../i)).not.toBeInTheDocument();
    // Still no fallback
    expect(screen.queryByText(/Not in provided material./i)).not.toBeInTheDocument();
  });

  it("2. Distinctly renders unsupported material fallback only when backend returns it", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      answer: "Not in provided material.",
      sources: [],
      wasFound: false,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AskComponent />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Computer Networks")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Ask about Computer Networks/i);
    fireEvent.change(input, { target: { value: "What is quantum computing?" } });
    fireEvent.click(screen.getByLabelText("Send"));

    await waitFor(() => {
      expect(screen.getByText("Not in provided material.")).toBeInTheDocument();
    });

    expect(
      screen.getByText(/This answer is not in the course materials currently uploaded for Computer Networks/i)
    ).toBeInTheDocument();
  });

  it("3. Displays an error banner and Retry button when API fails", async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error("Network connection lost"));

    render(
      <QueryClientProvider client={queryClient}>
        <AskComponent />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Computer Networks")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Ask about Computer Networks/i);
    fireEvent.change(input, { target: { value: "Explain subnetting" } });
    fireEvent.click(screen.getByLabelText("Send"));

    await waitFor(() => {
      expect(screen.getByText("Unable to process question")).toBeInTheDocument();
    });
    expect(screen.getByText("Network connection lost")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry question/i })).toBeInTheDocument();
  });
});
