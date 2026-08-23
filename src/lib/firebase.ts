import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import {
  type ServiceAccount,
  parseServiceAccount,
  missingServiceAccountFields,
} from "./service-account";

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

// --- Firebase Admin SDK (server-side only) ---

let _adminApp: { app: App } | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminRes: { db: any; isAdmin: boolean } | null = null;

/**
 * Load a firebase-admin module through Node's native require instead of a
 * bundler-resolved import. firebase-admin ships a CJS build whose internal
 * ESM/CJS interop is corrupted when it is bundled and converted to ESM
 * ("Cannot read properties of undefined (reading 'SDK_VERSION')"). Requiring it
 * at runtime keeps the original CJS require graph intact.
 */
export async function adminRequire<T>(id: string): Promise<T> {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  return require(id) as T;
}

async function resolveServiceAccount(): Promise<ServiceAccount | null> {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountRaw) {
    const parsed = parseServiceAccount(serviceAccountRaw);
    if (!parsed.ok) {
      console.error("[firebase-admin] " + parsed.error);
      return null;
    }
    const missing = missingServiceAccountFields(parsed.account);
    if (missing.length > 0) {
      console.error(
        "[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields: " +
          missing.join(", "),
      );
    }
    return parsed.account;
  }
  if (typeof window === "undefined") {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const keyPath = path.join(process.cwd(), "firebase-admin-key.json");
      if (fs.existsSync(keyPath)) {
        const fileParsed = parseServiceAccount(fs.readFileSync(keyPath, "utf8"));
        if (!fileParsed.ok) {
          console.error(
            "[firebase-admin] " +
              fileParsed.error.replace("FIREBASE_SERVICE_ACCOUNT_JSON", "firebase-admin-key.json"),
          );
          return null;
        }
        return fileParsed.account;
      }
    } catch (err) {
      console.error(
        "[firebase-admin] Failed to read firebase-admin-key.json:",
        err instanceof Error ? err.message : err,
      );
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
  } = await adminRequire<{
    initializeApp: (options?: object) => App;
    getApps: () => App[];
    cert: (serviceAccount: object) => unknown;
  }>("firebase-admin/app");
  const serviceAccount = await resolveServiceAccount();

  if (!serviceAccount) {
    console.warn(
      "[firebase-admin] No service account resolved (FIREBASE_SERVICE_ACCOUNT_JSON and firebase-admin-key.json are both absent). " +
        "Admin Auth token verification and Admin Firestore access will fail at runtime unless Application Default Credentials are available.",
    );
  } else if (serviceAccount.project_id) {
    const clientProjectId = getProjectId();
    if (clientProjectId && serviceAccount.project_id !== clientProjectId) {
      console.error(
        `[firebase-admin] Service account project_id "${serviceAccount.project_id}" does not match the client FIREBASE_PROJECT_ID "${clientProjectId}". ` +
          "Firebase ID token verification (verifyIdToken) will fail for signed-in users.",
      );
    }
  }

  let credential: ReturnType<typeof cert> | undefined;
  if (serviceAccount) {
    try {
      credential = cert(serviceAccount as never);
    } catch (err) {
      console.error(
        "[firebase-admin] Failed to build a credential from the service account " +
          "(check private_key formatting and newline escaping):",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  const app =
    getAdminApps().length === 0
      ? initAdmin(credential ? { credential } : undefined)
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
    const { getFirestore: getAdminFirestore } = await adminRequire<{
      getFirestore: (app: App) => unknown;
    }>("firebase-admin/firestore");
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
  const { getAuth } = await adminRequire<{ getAuth: (app: App) => Auth }>("firebase-admin/auth");
  return getAuth(app);
}

export { db };
