import { createFileRoute } from "@tanstack/react-router";
import { StudentAcademics } from "@/components/snippet/StudentAcademics";

export const Route = createFileRoute("/_authenticated/results")({
  head: () => ({
    meta: [
      { title: "My Results — Snippet" },
      { property: "og:title", content: "My Results — Snippet" },
      {
        name: "description",
        content: "View your verified academic grades, marks, and semester performance.",
      },
    ],
  }),
  component: () => <StudentAcademics initialTab="examResults" />,
});
