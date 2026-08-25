// SERVER-ONLY Firebase Admin module.
//
// This module owns every firebase-admin concern: static tracing edges,
// runtime loading, credentials, initialization, and errors.
//
// The three side-effect imports below are REQUIRED: Nitro's dependency tracer
// only packages node_modules it can see as static import edges (runtime-only
// createRequire is invisible to it — that caused the production
// "Cannot find module 'firebase-admin/app'" outage). vite.config.ts pairs
// these edges with nitro.traceDeps: ["firebase-admin*"] so the package stays
// EXTERNAL (its CJS graph intact — bundling it into app ESM previously caused
// the "SDK_VERSION of undefined" crash) and is copied into the Vercel function
// node_modules.
//
// DO NOT import this module from anything reachable by a public route.
// Public data paths must use src/lib/firebase.ts (client SDK + Firestore
// rules). Importing this module eagerly loads firebase-admin — including
// firebase-admin/auth → jwks-rsa → jose, which crashes non-require(esm)
// runtimes (ERR_REQUIRE_ESM).
import "firebase-admin/app";
import "firebase-admin/auth";
import "firebase-admin/firestore";

import fs from "node:fs";
import path from "node:path";
import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import {
  type ServiceAccount,
  parseServiceAccount,
  missingServiceAccountFields,
} from "../../lib/service-account";
import { getProjectId } from "../../lib/firebase";

/**
 * Stages where Admin initialization can fail. Surfaced on every thrown error so
 * Vercel logs pinpoint exactly which step broke:
 * - "service-account":     FIREBASE_SERVICE_ACCOUNT_JSON / key file exists but
 *                          is malformed JSON or an unexpected shape.
 * - "credentials-missing": neither the env var nor firebase-admin-key.json was
 *                          found (ADC may still be attempted explicitly).
 * - "module-load":         the firebase-admin package itself could not be
 *                          resolved at runtime (e.g. missing from the deployed
 *                          function bundle).
 * - "credential-build":    cert() rejected the service account (usually private
 *                          key formatting/newline escaping).
 * - "init":                initializeApp() itself threw.
 */
export type FirebaseAdminErrorStage =
  | "service-account"
  | "credentials-missing"
  | "module-load"
  | "credential-build"
  | "init";

/** Never carries secret values — only stage names and safe error messages. */
export class FirebaseAdminError extends Error {
  readonly stage: FirebaseAdminErrorStage;
  constructor(stage: FirebaseAdminErrorStage, message: string, options?: { cause?: unknown }) {
    super(`[firebase-admin/${stage}] ${message}`, options !== undefined ? options : undefined);
    this.name = "FirebaseAdminError";
    this.stage = stage;
  }
}

let _adminApp: { app: App } | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminRes: { db: any; isAdmin: true } | null = null;

/** Test-only: clear memoized Admin state between tests. Not part of the API. */
export function _resetFirebaseAdminForTests(): void {
  _adminApp = null;
  _adminRes = null;
}

/**
 * Load a firebase-admin module through Node's native require instead of a
 * bundler-resolved import binding. Paired with the side-effect static imports
 * above + nitro.traceDeps so the package is present in the deployed function
 * node_modules while the runtime require graph stays pure CJS.
 *
 * Resolution order:
 *  1. Relative to this module (Vercel colocates node_modules next to chunks).
 *  2. Relative to process.cwd() (function root).
 */
export async function adminRequire<T>(id: string): Promise<T> {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const errors: unknown[] = [];

  try {
    return createRequire(import.meta.url)(id) as T;
  } catch (err) {
    errors.push(err);
  }

  try {
    return createRequire(pathToFileURL(`${process.cwd()}/`).href)(id) as T;
  } catch (err) {
    errors.push(err);
  }

  const first = errors[0];
  throw first instanceof Error
    ? first
    : new Error(`Cannot find module '${id}'`);
}

type ResolvedCredential =
  | { source: "FIREBASE_SERVICE_ACCOUNT_JSON"; account: ServiceAccount }
  | { source: "firebase-admin-key.json"; account: ServiceAccount }
  | { source: "ADC"; account: null };

/**
 * Resolve the Admin credential. Throws FirebaseAdminError("service-account")
 * for present-but-invalid configuration instead of quietly continuing without
 * a credential. Only safe metadata (sources, field names) is ever logged.
 */
async function resolveServiceAccount(): Promise<ResolvedCredential> {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountRaw && serviceAccountRaw.trim()) {
    const parsed = parseServiceAccount(serviceAccountRaw);
    if (!parsed.ok) {
      // parsed.error intentionally excludes the raw value.
      throw new FirebaseAdminError("service-account", parsed.error);
    }
    const missing = missingServiceAccountFields(parsed.account);
    if (missing.length > 0) {
      console.error(
        "[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields: " +
          missing.join(", "),
      );
    }
    return { source: "FIREBASE_SERVICE_ACCOUNT_JSON", account: parsed.account };
  }
  if (typeof window === "undefined") {
    try {
      const keyPath = path.join(process.cwd(), "firebase-admin-key.json");
      if (fs.existsSync(keyPath)) {
        const fileParsed = parseServiceAccount(fs.readFileSync(keyPath, "utf8"));
        if (!fileParsed.ok) {
          throw new FirebaseAdminError(
            "service-account",
            fileParsed.error.replace("FIREBASE_SERVICE_ACCOUNT_JSON", "firebase-admin-key.json"),
          );
        }
        return { source: "firebase-admin-key.json", account: fileParsed.account };
      }
    } catch (err) {
      if (err instanceof FirebaseAdminError) throw err;
      throw new FirebaseAdminError(
        "service-account",
        "Failed to read firebase-admin-key.json: " +
          (err instanceof Error ? err.message : String(err)),
        { cause: err },
      );
    }
  }
  return { source: "ADC", account: null };
}

function warnOnProjectMismatch(account: ServiceAccount): void {
  if (!account.project_id) return;
  const clientProjectId = getProjectId();
  if (clientProjectId && account.project_id !== clientProjectId) {
    console.error(
      `[firebase-admin] Service account project_id "${account.project_id}" does not match the client FIREBASE_PROJECT_ID "${clientProjectId}". ` +
        "Firebase ID token verification (verifyIdToken) will fail for signed-in users.",
    );
  }
}

async function getAdminApp(): Promise<App> {
  if (_adminApp) return _adminApp.app;

  let adminAppModules: {
    initializeApp: (options?: object) => App;
    getApps: () => App[];
    cert: (serviceAccount: object) => unknown;
  };
  try {
    adminAppModules = await adminRequire<{
      initializeApp: (options?: object) => App;
      getApps: () => App[];
      cert: (serviceAccount: object) => unknown;
    }>("firebase-admin/app");
  } catch (err) {
    // Typical causes: firebase-admin absent from the deployed bundle, or a
    // corrupted install. The underlying message is preserved for diagnosis.
    throw new FirebaseAdminError(
      "module-load",
      "Failed to load firebase-admin/app at runtime. Verify firebase-admin is listed under \"dependencies\" (not devDependencies) and included in the deployed server bundle. Original error: " +
        (err instanceof Error ? err.message : String(err)),
      { cause: err },
    );
  }

  const resolved = await resolveServiceAccount();
  const { initializeApp: initAdmin, getApps: getAdminApps, cert } = adminAppModules;

  if (resolved.source === "ADC") {
    // Explicit (and logged) use of Application Default Credentials — e.g. GCP
    // runtimes. On platforms without ADC (like Vercel) downstream calls will
    // fail loudly instead of silently degrading.
    console.warn(
      "[firebase-admin] No service account resolved (FIREBASE_SERVICE_ACCOUNT_JSON and firebase-admin-key.json are both absent). " +
        "Attempting Application Default Credentials; Admin Auth/Firestore will fail at request time if none are available.",
    );
  } else {
    warnOnProjectMismatch(resolved.account);
  }

  let credential: ReturnType<typeof cert> | undefined;
  if (resolved.account) {
    try {
      credential = cert(resolved.account as never) as ReturnType<typeof cert>;
    } catch (err) {
      throw new FirebaseAdminError(
        "credential-build",
        "Failed to build a credential from the service account (check private_key formatting and newline escaping): " +
          (err instanceof Error ? err.message : String(err)),
        { cause: err },
      );
    }
  }

  let app: App;
  try {
    app =
      getAdminApps().length === 0
        ? initAdmin(credential ? { credential } : undefined)
        : getAdminApps()[0];
  } catch (err) {
    throw new FirebaseAdminError(
      "init",
      "firebase-admin initializeApp threw: " + (err instanceof Error ? err.message : String(err)),
      { cause: err },
    );
  }
  _adminApp = { app };

  const projectId = resolved.account?.project_id ?? getProjectId() ?? "unknown";
  console.log(
    `[firebase-admin] initialized source=${resolved.source} projectId=${projectId}`,
  );
  return app;
}

/**
 * Admin SDK Firestore for server-side access.
 *
 * NOTE: When a service account is configured this bypasses Firestore security
 * rules entirely, so every caller must enforce authorization itself (see
 * src/lib/server-auth.ts). Do not use this with client-supplied UIDs.
 *
 * There is deliberately NO fallback to the browser Firestore SDK here: an
 * unauthenticated client SDK running on the server cannot satisfy the
 * security rules for user-owned data, so every request would fail with an
 * opaque permission-denied while hiding the real initialization problem.
 * Failures throw FirebaseAdminError with the exact failing stage instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAdminDb(): Promise<{ db: any; isAdmin: true }> {
  if (_adminRes) return _adminRes;
  const app = await getAdminApp();
  let adminFirestore: unknown;
  try {
    const { getFirestore: getAdminFirestore } = await adminRequire<{
      getFirestore: (app: App) => unknown;
    }>("firebase-admin/firestore");
    adminFirestore = getAdminFirestore(app);
  } catch (err) {
    if (err instanceof FirebaseAdminError) throw err;
    throw new FirebaseAdminError(
      "module-load",
      "Failed to load firebase-admin/firestore at runtime. Original error: " +
        (err instanceof Error ? err.message : String(err)),
      { cause: err },
    );
  }
  _adminRes = { db: adminFirestore, isAdmin: true };
  return _adminRes;
}

/**
 * Firebase Admin Auth, used to verify client ID tokens server-side.
 */
export async function getAdminAuth(): Promise<Auth> {
  const app = await getAdminApp();
  let auth: Auth;
  try {
    const { getAuth } = await adminRequire<{ getAuth: (app: App) => Auth }>("firebase-admin/auth");
    auth = getAuth(app);
  } catch (err) {
    if (err instanceof FirebaseAdminError) throw err;
    throw new FirebaseAdminError(
      "module-load",
      "Failed to load firebase-admin/auth at runtime. Original error: " +
        (err instanceof Error ? err.message : String(err)),
      { cause: err },
    );
  }
  return auth;
}
