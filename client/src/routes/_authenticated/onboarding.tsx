import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: Onboarding,
});

function Onboarding() {
  const router = useRouter();
  useEffect(() => {
    router.history.push("/");
  }, []);
  return null;
}
