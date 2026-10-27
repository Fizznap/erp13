import { useEffect, useState } from "react";
import { apiBlob } from "@/lib/api";

export function useAvatarUrl(storedPath?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    if (storedPath?.startsWith("snippet-upload:")) {
      void apiBlob("/auth/avatar")
        .then((blob) => {
          if (!alive) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch(() => alive && setUrl(null));
    } else if (storedPath) {
      try {
        const candidate = new URL(storedPath);
        setUrl(
          candidate.protocol === "https:" &&
            candidate.hostname.toLowerCase().endsWith(".googleusercontent.com")
            ? candidate.toString()
            : null,
        );
      } catch {
        setUrl(null);
      }
    } else {
      setUrl(null);
    }
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storedPath]);
  return url;
}
