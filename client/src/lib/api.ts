const VITE_API_URL = import.meta.env["VITE_API_URL"] as string | undefined;
// If VITE_API_URL is provided (e.g. https://snippet-api.onrender.com), we append /api.
// If it already ends with /api, we keep it as is.
export const getApiBase = () => {
  if (VITE_API_URL) {
    return VITE_API_URL.endsWith("/api") ? VITE_API_URL : `${VITE_API_URL}/api`;
  }
  if (
    import.meta.env.PROD ||
    (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1")
  ) {
    return "https://snippet-api-pf9m.onrender.com/api";
  }
  return "http://localhost:3001/api";
};
export const API_BASE = getApiBase();

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("snippet_token");
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("snippet_refresh_token");
}

export function setTokens(accessToken: string, refreshToken: string | null) {
  localStorage.setItem("snippet_token", accessToken);
  if (refreshToken) localStorage.setItem("snippet_refresh_token", refreshToken);
  else localStorage.removeItem("snippet_refresh_token");
}

export function setOnboardingToken(accessToken: string) {
  localStorage.setItem("snippet_token", accessToken);
  localStorage.removeItem("snippet_refresh_token");
  localStorage.removeItem("snippet_user");
}

export function clearTokens() {
  localStorage.removeItem("snippet_token");
  localStorage.removeItem("snippet_refresh_token");
  localStorage.removeItem("snippet_user");
}

export async function logout(refreshToken: string | null): Promise<void> {
  try {
    await api("/auth/logout", {
      method: "POST",
      body: { refreshToken },
    });
  } catch {
    // Even if the server-side revocation fails, clear local session state.
  } finally {
    clearTokens();
    if (typeof window !== "undefined") {
      window.location.href = "/auth";
    }
  }
}

export function getStoredUser() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("snippet_user");
  return raw ? JSON.parse(raw) : null;
}

export function setStoredUser(user: unknown) {
  localStorage.setItem("snippet_user", JSON.stringify(user));
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    setTokens(data.accessToken, data.refreshToken || refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

export async function api<T = unknown>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {} } = options;

  const token = getToken();
  const requestHeaders: Record<string, string> = {
    ...headers,
  };

  if (token) {
    requestHeaders["Authorization"] = `Bearer ${token}`;
  }

  if (body && !(body instanceof FormData)) {
    requestHeaders["Content-Type"] = "application/json";
  }

  const config: RequestInit = {
    method,
    headers: requestHeaders,
  };

  if (body) {
    config.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  let res = await fetch(`${API_BASE}${endpoint}`, config);

  // If 401, try to refresh token
  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      requestHeaders["Authorization"] = `Bearer ${newToken}`;
      config.headers = requestHeaders;
      res = await fetch(`${API_BASE}${endpoint}`, config);
    } else {
      clearTokens();
      throw new Error("Session expired");
    }
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(errorData.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function apiBlob(endpoint: string): Promise<Blob> {
  const request = async (token: string | null) => fetch(`${API_BASE}${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let res = await request(getToken());
  if (res.status === 401 && getToken()) {
    const newToken = await refreshAccessToken();
    if (newToken) res = await request(newToken);
    else {
      clearTokens();
      throw new Error("Session expired");
    }
  }
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Could not load image" }));
    throw new Error(errorData.error || `HTTP ${res.status}`);
  }
  return res.blob();
}
