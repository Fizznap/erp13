import { createFileRoute } from "@tanstack/react-router";
import { StudentAcademics } from "@/components/snippet/StudentAcademics";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — Snippet" },
      {
        name: "description",
        content: "Mark attendance with your class code, review your history and subject-wise breakdown.",
      },
      { property: "og:title", content: "Attendance — Snippet" },
      { property: "og:description", content: "Mark attendance with a code and review semester statistics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <StudentAcademics initialTab="currentTerm" />,
});
