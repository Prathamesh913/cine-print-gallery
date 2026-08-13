import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null;

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

// --- Firebase Admin SDK (server-side only) ---

let _adminApp: { app: App } | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminRes: { db: any; isAdmin: boolean } | null = null;

async function resolveServiceAccount(): Promise<unknown> {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountRaw) {
    return JSON.parse(serviceAccountRaw);
  }
  if (typeof window === "undefined") {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const keyPath = path.join(process.cwd(), "firebase-admin-key.json");
      if (fs.existsSync(keyPath)) {
        return JSON.parse(fs.readFileSync(keyPath, "utf8"));
      }
    } catch {
      // fall through to unauthenticated app init
    }
  }
  return null;
}

async function getAdminApp(): Promise<App> {
  if (_adminApp) return _adminApp.app;

  const {
    initializeApp: initAdmin,
    getApps: getAdminApps,
    cert,
  } = await import("firebase-admin/app");
  const serviceAccount = await resolveServiceAccount();
  const app =
    getAdminApps().length === 0
      ? initAdmin(serviceAccount ? { credential: cert(serviceAccount as never) } : undefined)
      : getAdminApps()[0];
  _adminApp = { app };
  return app;
}

/**
 * Admin SDK Firestore for server-side writes.
 *
 * NOTE: When a service account is configured this bypasses Firestore security
 * rules entirely, so every caller must enforce authorization itself (see
 * src/lib/server-auth.ts). Do not use this with client-supplied UIDs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAdminDb(): Promise<{ db: any; isAdmin: boolean }> {
  if (_adminRes) return _adminRes;
  try {
    const app = await getAdminApp();
    const { getFirestore: getAdminFirestore } = await import("firebase-admin/firestore");
    _adminRes = { db: getAdminFirestore(app), isAdmin: true };
    return _adminRes;
  } catch (e) {
    console.warn(
      "Firebase Admin SDK not initialized. Set FIREBASE_SERVICE_ACCOUNT_JSON (or add firebase-admin-key.json) to enable server-side Firestore writes that bypass security rules. Falling back to the client SDK, which will be subject to Firestore security rules.",
      e,
    );
    _adminRes = { db, isAdmin: false };
    return _adminRes;
  }
}

/**
 * Firebase Admin Auth, used to verify client ID tokens server-side.
 */
export async function getAdminAuth(): Promise<Auth> {
  const app = await getAdminApp();
  const { getAuth } = await import("firebase-admin/auth");
  return getAuth(app);
}

export { db };
