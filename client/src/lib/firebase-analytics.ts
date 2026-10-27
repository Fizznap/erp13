import { getFirebaseWebConfig } from "./firebase.functions";

let started = false;

// Call from useEffect only. Firebase is additive: failures never affect the app.
export async function startFirebaseAnalytics() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const config = await getFirebaseWebConfig();
    if (!config) return;
    const { initializeApp, getApps } = await import("firebase/app");
    const { getAnalytics, isSupported } = await import("firebase/analytics");
    if (!(await isSupported())) return;
    const app = getApps()[0] ?? initializeApp(config);
    getAnalytics(app);
  } catch (e) {
    console.warn("Firebase analytics unavailable", e);
  }
}
