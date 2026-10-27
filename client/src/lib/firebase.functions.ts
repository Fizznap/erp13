import { createServerFn } from "@tanstack/react-start";

// Firebase web config values are public by design; only usage analytics uses them.
export const getFirebaseWebConfig = createServerFn({ method: "GET" }).handler(async () => {
  const apiKey = process.env['GOOGLE_API_KEY']?.trim();
  const measurementId = process.env['GOOGLE_ANALYTICS_MEASUREMENT_ID']?.trim();
  if (!apiKey || !measurementId) return null;
  return {
    apiKey,
    authDomain: "snippet-9b16f.firebaseapp.com",
    projectId: "snippet-9b16f",
    storageBucket: "snippet-9b16f.firebasestorage.app",
    messagingSenderId: "935171116671",
    appId: "1:935171116671:web:a72a1c2317b0e7211ff94a",
    measurementId,
  };
});
