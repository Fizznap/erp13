import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: any) => ({
    ...config,
    component: config.component,
  }),
  useNavigate: () => mockNavigate,
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(),
  };
});

import { api } from "@/lib/api";
import { Route as AuthRoute } from "@/routes/auth";

const AuthComponent = AuthRoute.component as React.ComponentType;

describe("AuthPage Login Error Handling", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    localStorage.clear();
  });

  const renderAuth = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AuthComponent />
      </QueryClientProvider>,
    );
  };

  it("1. ApiError preserves HTTP status and Retry-After header value", () => {
    const error = new ApiError("Too many login attempts", 429, 45, "RATE_LIMIT_EXCEEDED");
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(45);
    expect(error.message).toBe("Too many login attempts");
    expect(error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("2. Displays rate-limit message and disables submit button during cooldown on HTTP 429", async () => {
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError("Too many login attempts, please try again later.", 429, 30),
    );

    renderAuth();

    const emailInput = screen.getByPlaceholderText("College email");
    const passwordInput = screen.getByPlaceholderText("Password");
    const submitBtn = screen.getByRole("button", { name: "Sign in" });

    fireEvent.change(emailInput, { target: { value: "student@ustu.edu.in" } });
    fireEvent.change(passwordInput, { target: { value: "secret123" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Too many login attempts, please try again later."),
      ).toBeInTheDocument();
    });

    // The button must now be disabled and show cooldown timer
    const disabledBtn = screen.getByRole("button", { name: /Cooldown active/i });
    expect(disabledBtn).toBeDisabled();
    expect(disabledBtn).toHaveTextContent(/Cooldown active \(30s\)/i);
  });

  it("3. Distinguishes HTTP 401 as 'Invalid email or password' without implying rate limiting", async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError("Invalid credentials", 401));

    renderAuth();

    const emailInput = screen.getByPlaceholderText("College email");
    const passwordInput = screen.getByPlaceholderText("Password");
    const submitBtn = screen.getByRole("button", { name: "Sign in" });

    fireEvent.change(emailInput, { target: { value: "student@ustu.edu.in" } });
    fireEvent.change(passwordInput, { target: { value: "wrongpassword" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Invalid email or password")).toBeInTheDocument();
    });

    // Submit button should NOT be in cooldown
    expect(screen.getByRole("button", { name: "Sign in" })).not.toBeDisabled();
  });

  it("4. Displays clear network error when connection to server fails", async () => {
    vi.mocked(api).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderAuth();

    const emailInput = screen.getByPlaceholderText("College email");
    const passwordInput = screen.getByPlaceholderText("Password");
    const submitBtn = screen.getByRole("button", { name: "Sign in" });

    fireEvent.change(emailInput, { target: { value: "student@ustu.edu.in" } });
    fireEvent.change(passwordInput, { target: { value: "secret123" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Network error. Unable to reach the server."),
      ).toBeInTheDocument();
    });
  });

  it("5. Displays server error message on HTTP 500", async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError("Internal server error", 500));

    renderAuth();

    const emailInput = screen.getByPlaceholderText("College email");
    const passwordInput = screen.getByPlaceholderText("Password");
    const submitBtn = screen.getByRole("button", { name: "Sign in" });

    fireEvent.change(emailInput, { target: { value: "student@ustu.edu.in" } });
    fireEvent.change(passwordInput, { target: { value: "secret123" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Server error. Please try again later."),
      ).toBeInTheDocument();
    });
  });
});
