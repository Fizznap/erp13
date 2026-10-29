import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("matches admin index and child routes without root fallback", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const adminMatches = router.matchRoutes("/admin");
    expect(adminMatches.at(-1)?.routeId).toBe("/_authenticated/admin/");

    const adminResultsMatches = router.matchRoutes("/admin/results");
    expect(adminResultsMatches.at(-1)?.routeId).toBe("/_authenticated/admin/results");

    const studentResultsMatches = router.matchRoutes("/results");
    expect(studentResultsMatches.at(-1)?.routeId).toBe("/_authenticated/results");
  });
});
