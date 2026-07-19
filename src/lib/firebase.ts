import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

let db: any = null;

if (typeof window === "undefined") {
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
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

    const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const app =
      getAdminApps().length === 0
        ? initAdmin(
            serviceAccountRaw ? { credential: cert(JSON.parse(serviceAccountRaw)) } : undefined,
          )
        : getAdminApps()[0];
    _adminRes = { db: getAdminFirestore(app), isAdmin: true };
    return _adminRes;
  } catch (e) {
    console.warn("Firebase Admin SDK not available, falling back to client SDK", e);
    _adminRes = { db, isAdmin: false };
    return _adminRes;
  }
}

export { db };
