import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/face-setup")({
  component: FaceSetup,
});

function FaceSetup() {
  const router = useRouter();
  useEffect(() => {
    router.history.push("/profile");
  }, []);
  return null;
}
