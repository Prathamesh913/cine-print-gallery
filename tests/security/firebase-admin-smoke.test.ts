import { describe, expect, it } from "vitest";

/**
 * Smoke test for the Firebase Admin SDK_VERSION failure.
 *
 * The production failure ("Cannot read properties of undefined (reading
 * 'SDK_VERSION')") is caused by Nitro's _libs ESM conversion of the CJS
 * firebase-admin package. That specific defect only exists in the bundled
 * server output and cannot be reproduced from vitest, which imports the real
 * node_modules package. This test guards the adjacent invariant instead: the
 * firebase-admin/app module must resolve and expose the SDK_VERSION constant
 * (the value Nitro's conversion loses), so an import-path or package regression
 * fails here rather than in production.
 */
describe("firebase-admin server smoke", () => {
  it("firebase-admin/app resolves and exposes SDK_VERSION", async () => {
    const mod = await import("firebase-admin/app");
    expect(mod.SDK_VERSION).toBeDefined();
    expect(typeof mod.initializeApp).toBe("function");
    expect(typeof mod.cert).toBe("function");
  });

  it("firebase-admin/auth resolves and exposes getAuth", async () => {
    const mod = await import("firebase-admin/auth");
    expect(typeof mod.getAuth).toBe("function");
  });
});
