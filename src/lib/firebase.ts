import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

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

// Admin SDK for server-side writes (bypasses security rules)
let _adminRes: { db: any; isAdmin: boolean } | null = null;

export async function getAdminDb(): Promise<{ db: any; isAdmin: boolean }> {
  if (_adminRes) return _adminRes;
  try {
    const { initializeApp: initAdmin, getApps: getAdminApps, cert } =
      await import("firebase-admin/app");
    const { getFirestore: getAdminFirestore } = await import("firebase-admin/firestore");

    let serviceAccount: unknown = null;
    const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (serviceAccountRaw) {
      serviceAccount = JSON.parse(serviceAccountRaw);
    } else if (typeof window === "undefined") {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const keyPath = path.join(process.cwd(), "firebase-admin-key.json");
        if (fs.existsSync(keyPath)) {
          serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
        }
      } catch {
        // fall through to client SDK fallback
      }
    }

    const app =
      getAdminApps().length === 0
        ? initAdmin(serviceAccount ? { credential: cert(serviceAccount as never) } : undefined)
        : getAdminApps()[0];
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

export { db };
