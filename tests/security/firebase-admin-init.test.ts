import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Regression tests for the Firebase Admin initialization hotfix.
 *
 * Production previously failed silently: when Admin initialization failed
 * (missing runtime module, bad credentials, …), getAdminDb() fell back to the
 * unauthenticated CLIENT Firestore SDK running server-side. Every
 * authenticated read then died on Firestore rules with an opaque
 * permission-denied, hiding the real cause.
 *
 * These tests pin the fixed behavior:
 *  - every failure mode throws FirebaseAdminError with an explicit stage,
 *  - there is NO fallback to the client SDK,
 *  - the underlying cause stays observable without leaking secret material.
 */

const adminRequireState = vi.hoisted(() => ({
  /** When null, createRequire(...) behaves like the module cannot be found. */
  impl: null as ((id: string) => unknown) | null,
}));

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    // Both resolution roots (import.meta.url and process.cwd()) share the same
    // mock so module-load failure tests still cover the full adminRequire path.
    createRequire: () => {
      return (id: string) => {
        if (!adminRequireState.impl) {
          throw new Error(`Cannot find module '${id}'`);
        }
        return adminRequireState.impl(id);
      };
    },
  };
});

const ENV_KEYS = [
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_PROJECT_ID",
] as const;

const VALID_SA = {
  type: "service_account",
  project_id: "test-proj",
  private_key_id: "kid",
  private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n",
  client_email: "admin@test-proj.iam.gserviceaccount.com",
};

const FAKE_DB = { __fakeAdminDb: true };

function makeAdminRequireImpl(opts?: {
  certError?: Error;
}): { impl: (id: string) => unknown; appModuleLoads: () => number } {
  let appModuleLoadCount = 0;
  const impl = (id: string): unknown => {
    switch (id) {
      case "firebase-admin/app": {
        appModuleLoadCount += 1;
        return {
          SDK_VERSION: "test",
          initializeApp: (options?: object) => ({ __fakeApp: true, options }),
          getApps: () => [],
          cert: (serviceAccount: object) => {
            if (opts?.certError) throw opts.certError;
            return { __certFrom: Boolean(serviceAccount) };
          },
        };
      }
      case "firebase-admin/firestore":
        return {
          getFirestore: () => FAKE_DB,
          FieldValue: {
            serverTimestamp: () => "SERVER_TIMESTAMP",
            arrayUnion: (...args: unknown[]) => ({ union: args }),
            arrayRemove: (...args: unknown[]) => ({ remove: args }),
          },
          Timestamp: { fromDate: (date: Date) => date.toISOString() },
        };
      case "firebase-admin/auth":
        return { getAuth: () => ({ __fakeAuth: true }) };
      default:
        throw new Error(`Cannot find module '${id}'`);
    }
  };
  return { impl, appModuleLoads: () => appModuleLoadCount };
}

async function importFirebase() {
  return await import("../../src/server/firebase/admin");
}

let savedEnv: Record<string, string | undefined>;
let previousCwd = process.cwd();

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  adminRequireState.impl = null;
  vi.resetModules();
});

afterEach(() => {
  process.chdir(previousCwd);
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.restoreAllMocks();
});

function captureConsole() {
  const errors: string[] = [];
  const warnings: string[] = [];
  const logs: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  return { errors, warnings, logs };
}

describe("firebase-admin initialization diagnostics", () => {
  it("fails explicitly when FIREBASE_SERVICE_ACCOUNT_JSON is malformed (no silent degradation)", async () => {
    const console_ = captureConsole();
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"project_id": "broken"';
    // Module resolution succeeds; only the credential payload is invalid.
    adminRequireState.impl = makeAdminRequireImpl().impl;
    const firebase = await importFirebase();

    const err = await firebase.getAdminDb().then(
      () => null,
      (e: unknown) => e as Error & { stage?: string },
    );

    expect(err).not.toBeNull();
    expect(err?.name).toBe("FirebaseAdminError");
    expect(err?.stage).toBe("service-account");
    expect(err?.message).toContain("not valid JSON");
    // The raw environment value must not be echoed into logs or the error.
    expect(err?.message).not.toContain("broken");
    expect(console_.errors.join("\n")).not.toContain("broken");
  });

  it("warns explicitly and attempts ADC when no credential source exists", async () => {
    const console_ = captureConsole();
    // No env vars set. Run from a directory WITHOUT firebase-admin-key.json.
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-fb-admin-"));
    process.chdir(emptyDir);

    try {
      adminRequireState.impl = makeAdminRequireImpl().impl;
      const firebase = await importFirebase();
      const res = await firebase.getAdminDb();

      expect(res.isAdmin).toBe(true);
      expect(
        console_.warnings.some((w) =>
          w.includes("No service account resolved"),
        ),
      ).toBe(true);
      // The ADC attempt itself is explicit and observable, never silent.
      expect(console_.logs.some((l) => l.includes("initialized source=ADC"))).toBe(true);
    } finally {
      fs.rmdirSync(emptyDir);
    }
  });

  it("reports a module-load failure with the original cause preserved", async () => {
    const console_ = captureConsole();
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(VALID_SA);
    adminRequireState.impl = null; // simulate firebase-admin missing from the bundle

    const firebase = await importFirebase();
    const err = await firebase.getAdminDb().then(
      () => null,
      (e: unknown) => e as Error & { stage?: string; cause?: unknown },
    );

    expect(err?.name).toBe("FirebaseAdminError");
    expect(err?.stage).toBe("module-load");
    expect(err?.message).toContain("Cannot find module 'firebase-admin/app'");
    expect((err?.cause as Error | undefined)?.message).toContain(
      "Cannot find module 'firebase-admin/app'",
    );
    // No success line, and definitely no fallback result.
    expect(console_.logs.join("\n")).not.toContain("initialized");
  });

  it("reports credential-build failures when cert() rejects the service account", async () => {
    captureConsole();
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(VALID_SA);
    adminRequireState.impl = makeAdminRequireImpl({
      certError: new Error("Invalid PEM formatted message."),
    }).impl;

    const firebase = await importFirebase();
    const err = await firebase.getAdminDb().then(
      () => null,
      (e: unknown) => e as Error & { stage?: string },
    );

    expect(err?.name).toBe("FirebaseAdminError");
    expect(err?.stage).toBe("credential-build");
    expect(err?.message).toContain("Invalid PEM formatted message.");
  });

  it("initializes successfully from FIREBASE_SERVICE_ACCOUNT_JSON, logs safe metadata, and caches the result", async () => {
    const console_ = captureConsole();
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(VALID_SA);
    process.env.FIREBASE_PROJECT_ID = "client-proj"; // intentionally different
    const { impl, appModuleLoads } = makeAdminRequireImpl();
    adminRequireState.impl = impl;

    const firebase = await importFirebase();
    const res = await firebase.getAdminDb();

    expect(res.isAdmin).toBe(true);
    expect(res.db).toBe(FAKE_DB);
    expect(
      console_.logs.some((l) => l.includes("source=FIREBASE_SERVICE_ACCOUNT_JSON projectId=test-proj")),
    ).toBe(true);
    // Project mismatch between the service account and the client config is surfaced.
    expect(console_.errors.some((e) => e.includes("does not match"))).toBe(true);

    // Second call must be served from cache (no additional module loads).
    await firebase.getAdminDb();
    expect(appModuleLoads()).toBe(1);
  });
});

describe("requireAuth vs server misconfiguration", () => {
  it("propagates FirebaseAdminError instead of masking it as an auth failure", async () => {
    captureConsole();
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(VALID_SA);
    adminRequireState.impl = null; // admin module unavailable -> configuration failure

    const { requireAuth } = await import("../../src/lib/server-auth");

    const err = await requireAuth("some-token", "some-uid").then(
      () => null,
      (e: unknown) => e as Error & { stage?: string; name: string },
    );

    expect(err?.name).toBe("FirebaseAdminError");
    expect(err?.stage).toBe("module-load");
  });

  it("still returns UnauthorizedError (not FirebaseAdminError) for genuinely invalid tokens", async () => {
    captureConsole();
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(VALID_SA);

    const stubAuth = {
      verifyIdToken: async () => {
        const failure = new Error("Firebase ID token has invalid aud claim.") as Error & {
          code?: string;
        };
        failure.code = "auth/argument-error";
        throw failure;
      },
    };
    adminRequireState.impl = (id: string) => {
      if (id === "firebase-admin/app") {
        return {
          initializeApp: () => ({ __fakeApp: true }),
          getApps: () => [],
          cert: () => ({ __cert: true }),
        };
      }
      if (id === "firebase-admin/auth") return { getAuth: () => stubAuth };
      throw new Error(`Cannot find module '${id}'`);
    };

    const { requireAuth, UnauthorizedError } = await import("../../src/lib/server-auth");

    const err = await requireAuth("user-token").then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as Error & { name?: string }).name).toBe("UnauthorizedError");
  });
});
