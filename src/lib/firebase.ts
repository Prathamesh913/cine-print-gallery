// PUBLIC Firebase module: client SDK initialization only.
//
// This module must stay loadable by any route without executing firebase-admin
// code. All Admin concerns (runtime loading, credentials, initialization,
// FirebaseAdminError) live in src/server/firebase/admin.ts — import that ONLY
// from authenticated server paths.
//
// Invariant: importing this file from a public route must not load
// firebase-admin. Guarded by tests/security/public-firebase-isolation.test.ts.
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null;

function readEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    const direct = process.env[key];
    if (direct) return direct;
    const vite = process.env[`VITE_${key}`];
    if (vite) return vite;
  }
  if (typeof import.meta !== "undefined") {
    const meta = import.meta as ImportMeta & { env?: Record<string, string> };
    return meta.env?.[key] || meta.env?.[`VITE_${key}`];
  }
  return undefined;
}

/**
 * The Firebase project id used by the client SDK. Server-side Admin operations
 * must target the same project for ID-token verification to succeed.
 */
export function getProjectId(): string | undefined {
  return readEnv("FIREBASE_PROJECT_ID");
}

if (typeof window === "undefined") {
  const env = (key: string) =>
    process.env[key] ||
    process.env[`VITE_${key}`] ||
    (typeof import.meta !== "undefined"
      ? (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[key] ||
        (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[`VITE_${key}`]
      : undefined);

  const firebaseConfig = {
    apiKey: env("FIREBASE_API_KEY"),
    authDomain: env("FIREBASE_AUTH_DOMAIN"),
    projectId: env("FIREBASE_PROJECT_ID"),
    storageBucket: env("FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: env("FIREBASE_MESSAGING_SENDER_ID"),
    appId: env("FIREBASE_APP_ID"),
  };

  if (firebaseConfig.projectId) {
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    db = getFirestore(app);
  } else {
    console.warn("Firebase configuration env variables are missing.");
  }
}

export { db };
