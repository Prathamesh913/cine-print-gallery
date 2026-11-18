import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toPublicError } from "../../src/server/errors/error-response";

/**
 * Regression tripwire for the anonymous submission error echo (security audit
 * run 1).
 *
 * What happened: submitPosterToNotion is a public server function with no auth
 * middleware. Its catch block rethrew `Error("Failed all insertion attempts.
 * Error: " + err.message)`, and TanStack Start serialises the thrown value with
 * its message intact, so FirebaseAdminError stage/module text and Firestore
 * error text reached the caller. Every migrated feature uses the shared
 * envelope instead.
 *
 * Invariant under test: this handler returns the client-safe envelope, and
 * unknown/internal errors collapse to the generic INTERNAL body.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const notionSource = fs.readFileSync(path.join(repoRoot, "src/lib/notion.ts"), "utf8");

describe("submitPosterToNotion error handling", () => {
  it("returns the public error body instead of echoing the internal message", () => {
    const catchStart = notionSource.lastIndexOf("} catch (err) {");
    expect(catchStart, "the submission handler must keep an explicit catch").toBeGreaterThan(-1);
    const catchTail = notionSource.slice(catchStart);

    expect(catchTail).toMatch(/toPublicError\(err\)/);
    expect(catchTail).not.toMatch(/err\.message/);
    expect(catchTail).not.toMatch(/Failed all insertion attempts/);
  });

  it("collapses internal text to the generic INTERNAL body", () => {
    const leaked = new Error(
      "[firebase-admin/module-load] Cannot find module 'firebase-admin/app'",
    );
    const body = toPublicError(leaked);

    expect(body).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong. Please try again." },
    });
    expect(JSON.stringify(body)).not.toContain("firebase-admin");
  });

  it("treats a returned error envelope as failure in the submit UI", () => {
    const submitSource = fs.readFileSync(path.join(repoRoot, "src/routes/submit.tsx"), "utf8");
    expect(submitSource).toMatch(/"ok" in res/);
  });
});
