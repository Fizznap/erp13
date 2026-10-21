export function useAvatarUrl(storedPath?: string | null) {
  if (!storedPath) return null;
  try {
    const url = new URL(storedPath);
    return url.protocol === "https:" &&
      url.hostname.toLowerCase().endsWith(".googleusercontent.com")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
export async function uploadAvatar(file: File) {
  return null;
}
