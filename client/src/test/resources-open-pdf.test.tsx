import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetchResourcePdf } from "@/lib/api";

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

// Mock AppShell to keep tests focused on the resources UI
vi.mock("@/components/snippet/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  Progress: () => <div />,
  Spark: () => <span />,
}));

import { Route as ResourcesRoute } from "@/routes/_authenticated/resources";

// Helper to construct a valid minimal synthetic PDF buffer starting with %PDF-
function createMockPdfBuffer(content = "Test PDF Document"): Uint8Array {
  const header = "%PDF-1.4\n";
  const body = `1 0 obj\n<< /Title (${content}) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;
  const text = header + body;
  const encoder = new TextEncoder();
  return encoder.encode(text);
}

describe("Feed / Resources PDF viewing and downloading regression tests", () => {
  let queryClient: QueryClient;
  const originalFetch = globalThis.fetch;
  const originalOpen = window.open;
  const originalCreateObjectURL = window.URL.createObjectURL;
  const originalRevokeObjectURL = window.URL.revokeObjectURL;

  let mockPopup: {
    location: { href: string };
    closed: boolean;
    close: ReturnType<typeof vi.fn>;
    document: { title: string };
    addEventListener: ReturnType<typeof vi.fn>;
  };
  let createdObjectUrls: string[];
  let revokedObjectUrls: string[];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    });
    localStorage.clear();
    localStorage.setItem("snippet_token", "valid-test-token-jwt");

    createdObjectUrls = [];
    revokedObjectUrls = [];

    mockPopup = {
      location: { href: "about:blank" },
      closed: false,
      close: vi.fn(function (this: any) {
        this.closed = true;
      }),
      document: { title: "about:blank" },
      addEventListener: vi.fn(),
    };

    window.open = vi.fn().mockImplementation((url?: string) => {
      if (url === "about:blank" || !url) {
        return mockPopup as unknown as Window;
      }
      return { ...mockPopup, location: { href: url } } as unknown as Window;
    });

    window.URL.createObjectURL = vi.fn((blob: Blob) => {
      const url = `blob:http://localhost:3000/${Math.random().toString(36).substring(7)}`;
      createdObjectUrls.push(url);
      return url;
    });

    window.URL.revokeObjectURL = vi.fn((url: string) => {
      revokedObjectUrls.push(url);
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.open = originalOpen;
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  function setupFetchForResources(options?: {
    pdfBytes?: Uint8Array;
    pdfStatus?: number;
    pdfErrorBody?: any;
    pdfContentType?: string;
  }) {
    const status = options?.pdfStatus ?? 200;
    const isOk = status >= 200 && status < 300;
    const pdfBytes = options?.pdfBytes ?? createMockPdfBuffer("AML Lecture Notes");

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const urlStr = String(url);

      if (urlStr.includes("/subjects")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              subjects: [
                { id: "sub-aml", name: "Applied Machine Learning", code: "AML401", offering_id: "off-aml" },
              ],
            }),
        } as Response);
      }

      if (urlStr.includes("/resources?") || (urlStr.includes("/resources") && !urlStr.includes("/download"))) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              resources: [
                {
                  id: "res-aml-1",
                  original_name: "AML_Unit1_Supervised.pdf",
                  filename: "aml-unit1-uuid.pdf",
                  kind: "PDFs",
                  file_size: 1048576,
                  created_at: new Date().toISOString(),
                  status: "ready",
                },
              ],
            }),
        } as Response);
      }

      if (urlStr.includes("/download")) {
        if (!isOk) {
          const errorBody = options?.pdfErrorBody ?? { error: "Resource not available" };
          return Promise.resolve({
            ok: false,
            status,
            headers: new Headers({ "content-type": "application/json" }),
            json: () => Promise.resolve(errorBody),
            text: () => Promise.resolve(typeof errorBody === "string" ? errorBody : JSON.stringify(errorBody)),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            "content-type": options?.pdfContentType ?? "application/pdf",
            "content-disposition": "inline; filename=\"AML_Unit1_Supervised.pdf\"",
          }),
          arrayBuffer: () => Promise.resolve(pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength)),
          blob: () => Promise.resolve(new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" })),
        } as Response);
      }

      return Promise.reject(new Error(`Unhandled URL: ${urlStr}`));
    });
  }

  it("1. Clicking Open opens PDF inline in a new tab without forcing a download with filename 'download'", async () => {
    setupFetchForResources();
    const ResourcesComponent = (ResourcesRoute as any).component;

    // Spy on document.createElement to ensure <a download="download"> is NOT created during Open
    const originalCreateElement = document.createElement.bind(document);
    let downloadAttributeSet: string | null = null;
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName.toLowerCase() === "a") {
        Object.defineProperty(el, "download", {
          set(val: string) {
            downloadAttributeSet = val;
          },
          get() {
            return downloadAttributeSet || "";
          },
        });
      }
      return el;
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    // Wait for the resource card to appear
    await waitFor(() => {
      expect(screen.getByText("AML_Unit1_Supervised.pdf")).toBeInTheDocument();
    });

    const openButton = screen.getByRole("button", { name: /Open/i });
    expect(openButton).toBeInTheDocument();

    fireEvent.click(openButton);

    // Verify window.open was called synchronously
    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");

    // Wait for fetch and navigation to complete
    await waitFor(() => {
      expect(mockPopup.location.href).toMatch(/^blob:http:\/\/localhost:3000\//);
    });

    // CRITICAL REGRESSION CHECK:
    // Ensure that no forced download with filename "download" was executed
    expect(downloadAttributeSet).toBeNull();
    expect(mockPopup.closed).toBe(false);

    createElementSpy.mockRestore();
  });

  it("2. Protected download endpoint is called with existing Bearer token authorization header", async () => {
    setupFetchForResources();
    const ResourcesComponent = (ResourcesRoute as any).component;

    render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("AML_Unit1_Supervised.pdf")).toBeInTheDocument();
    });

    const openButton = screen.getByRole("button", { name: /Open/i });
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/resources/res-aml-1/download?disposition=inline"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer valid-test-token-jwt",
          }),
        })
      );
    });
  });

  it("3. HTTP 403 Forbidden is handled safely: closes popup and displays error without treating response as PDF", async () => {
    setupFetchForResources({
      pdfStatus: 403,
      pdfErrorBody: { error: "Access denied: not enrolled in this offering" },
    });
    const ResourcesComponent = (ResourcesRoute as any).component;

    render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("AML_Unit1_Supervised.pdf")).toBeInTheDocument();
    });

    const openButton = screen.getByRole("button", { name: /Open/i });
    fireEvent.click(openButton);

    // The popup should be closed when fetch fails
    await waitFor(() => {
      expect(mockPopup.close).toHaveBeenCalled();
    });

    // The error message must be shown in the UI
    await waitFor(() => {
      expect(
        screen.getByText(/Access denied: not enrolled in this offering/i)
      ).toBeInTheDocument();
    });

    // No blob URL should have been navigated to
    expect(mockPopup.location.href).toBe("about:blank");
  });

  it("4. Missing file (HTTP 404 from ephemeral storage restart) displays actionable error and closes popup", async () => {
    setupFetchForResources({
      pdfStatus: 404,
      pdfErrorBody: { error: "File is no longer available in storage. It may have been cleared by a server restart." },
    });
    const ResourcesComponent = (ResourcesRoute as any).component;

    render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("AML_Unit1_Supervised.pdf")).toBeInTheDocument();
    });

    const openButton = screen.getByRole("button", { name: /Open/i });
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(mockPopup.close).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/File is no longer available in storage/i)
      ).toBeInTheDocument();
    });
  });

  it("5. Non-PDF response (HTML error or missing %PDF- signature) throws validation error and does not view as PDF", async () => {
    const htmlBytes = new TextEncoder().encode("<!DOCTYPE html><html><body>Error Gateway</body></html>");
    setupFetchForResources({
      pdfBytes: htmlBytes,
      pdfContentType: "text/html",
    });
    const ResourcesComponent = (ResourcesRoute as any).component;

    render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("AML_Unit1_Supervised.pdf")).toBeInTheDocument();
    });

    const openButton = screen.getByRole("button", { name: /Open/i });
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(mockPopup.close).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/not a valid PDF document/i)
      ).toBeInTheDocument();
    });
  });

  it("6. Explicit Download action triggers download with actual original filename rather than 'download'", async () => {
    setupFetchForResources();
    const ResourcesComponent = (ResourcesRoute as any).component;

    let downloadedFilename = "";
    let downloadHref = "";
    let clickCalled = false;

    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName.toLowerCase() === "a") {
        Object.defineProperty(el, "download", {
          set(val: string) {
            downloadedFilename = val;
          },
          get() {
            return downloadedFilename;
          },
        });
        Object.defineProperty(el, "href", {
          set(val: string) {
            downloadHref = val;
          },
          get() {
            return downloadHref;
          },
        });
        el.click = vi.fn(() => {
          clickCalled = true;
        });
      }
      return el;
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("AML_Unit1_Supervised.pdf")).toBeInTheDocument();
    });

    const downloadButton = screen.getByRole("button", { name: /Download AML_Unit1_Supervised.pdf/i });
    expect(downloadButton).toBeInTheDocument();

    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(clickCalled).toBe(true);
    });

    // Check that it downloaded as the real filename, NOT generic "download"
    expect(downloadedFilename).toBe("AML_Unit1_Supervised.pdf");
    expect(downloadHref).toMatch(/^blob:http:\/\/localhost:3000\//);

    createElementSpy.mockRestore();
  });

  it("7. fetchResourcePdf function validates PDF signature and creates application/pdf Blob", async () => {
    const validPdf = createMockPdfBuffer("Valid Content");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/pdf" }),
      arrayBuffer: () => Promise.resolve(validPdf.buffer),
    } as unknown as Response);

    const blob = await fetchResourcePdf("res-123", "inline");
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(validPdf.length);

    // Reject non-PDF
    const corruptBuffer = new TextEncoder().encode("NOT A PDF FILE");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/pdf" }),
      arrayBuffer: () => Promise.resolve(corruptBuffer.buffer),
    } as unknown as Response);

    await expect(fetchResourcePdf("res-corrupt")).rejects.toThrow(/not a valid PDF/i);
  });

  it("8. Keeping PDF open longer than 60 seconds does not revoke URL; closing tab triggers revocation", async () => {
    vi.useFakeTimers();
    setupFetchForResources();
    const ResourcesComponent = (ResourcesRoute as any).component;

    render(
      <QueryClientProvider client={queryClient}>
        <ResourcesComponent />
      </QueryClientProvider>
    );

    await vi.waitFor(() => {
      expect(screen.getByText("AML_Unit1_Supervised.pdf")).toBeInTheDocument();
    });

    const openButton = screen.getByRole("button", { name: /Open/i });
    fireEvent.click(openButton);

    await vi.waitFor(() => {
      expect(createdObjectUrls.length).toBe(1);
    });

    const activeUrl = createdObjectUrls[0];

    // Advance time past 60 seconds (120s) while tab remains open
    await vi.advanceTimersByTimeAsync(120000);

    // Verify Blob URL is STILL ACTIVE and NOT revoked after 120 seconds
    expect(revokedObjectUrls).not.toContain(activeUrl);

    // Simulate user closing the tab
    mockPopup.closed = true;

    // Advance interval timer (1.5s)
    await vi.advanceTimersByTimeAsync(2000);

    // Verify Blob URL is now revoked upon tab closure
    expect(revokedObjectUrls).toContain(activeUrl);

    vi.useRealTimers();
  });
});
