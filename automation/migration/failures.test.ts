import { describe, expect, it } from "vitest";
import {
  FAILURE_CATEGORIES,
  FAILURE_POLICIES,
  HARD_STOP_CATEGORIES,
  classifyFailure,
  decideFailure,
  isHardStop,
  policyFor,
} from "./failures";
import { R2ConflictError, R2UploadError, R2UploadUnknownError } from "./r2";
import { SourceChangedError, SourceHttpStatusError, SourceValidationError } from "./source";
import { MigrationLockError, MigrationStateError } from "./state";

describe("F22 — failure categories and operator actions", () => {
  it("defines a complete policy for every category", () => {
    for (const category of FAILURE_CATEGORIES) {
      const policy = policyFor(category);
      expect(policy.category).toBe(category);
      expect(policy.operatorAction.length).toBeGreaterThan(10);
      expect(policy.requiredEvidence.length).toBeGreaterThan(0);
      expect(typeof policy.retryable).toBe("boolean");
      expect(typeof policy.skippable).toBe("boolean");
      expect(typeof policy.pauseBatch).toBe("boolean");
      expect(typeof policy.stopRun).toBe("boolean");
    }
    expect(Object.keys(FAILURE_POLICIES)).toHaveLength(FAILURE_CATEGORIES.length);
  });

  it("treats safety-critical categories as hard stops", () => {
    for (const category of [
      "SOURCE_CHANGED",
      "R2_CONFLICT",
      "R2_AMBIGUOUS",
      "ORIGIN_VERIFICATION_FAILED",
      "METADATA_MISMATCH",
      "CHECKSUM_MISMATCH",
      "LOCK_UNAVAILABLE",
      "STATE_PERSISTENCE_FAILED",
      "PREFLIGHT_INCOMPLETE",
      "INVENTORY_MISMATCH",
      "INTERNAL_ERROR",
    ] as const) {
      expect(isHardStop(category), category).toBe(true);
      expect(HARD_STOP_CATEGORIES.has(category)).toBe(true);
      expect(decideFailure(category).action).toBe("stop");
    }
  });

  it("allows transient source and upload failures to retry", () => {
    expect(decideFailure("SOURCE_TRANSIENT").action).toBe("retry");
    expect(decideFailure("R2_TRANSIENT").action).toBe("retry");
    expect(decideFailure("CDN_VERIFICATION_FAILED").action).toBe("retry");
  });

  it("skips permanent source and optimization failures without stopping the run", () => {
    expect(decideFailure("SOURCE_PERMANENT").action).toBe("skip");
    expect(decideFailure("SOURCE_VALIDATION_FAILED").action).toBe("skip");
    expect(decideFailure("OPTIMIZATION_FAILED").action).toBe("skip");
  });

  it("classifies known error types deterministically", () => {
    expect(classifyFailure(new SourceChangedError("changed"))).toBe("SOURCE_CHANGED");
    expect(classifyFailure(new SourceValidationError("bad"))).toBe("SOURCE_VALIDATION_FAILED");
    expect(classifyFailure(new SourceHttpStatusError("x", 404, false))).toBe("SOURCE_PERMANENT");
    expect(classifyFailure(new SourceHttpStatusError("x", 503, true))).toBe("SOURCE_TRANSIENT");
    expect(classifyFailure(new R2ConflictError("conflict"))).toBe("R2_CONFLICT");
    expect(classifyFailure(new R2UploadUnknownError("unknown"))).toBe("R2_AMBIGUOUS");
    expect(classifyFailure(new R2UploadError("retry", true))).toBe("R2_TRANSIENT");
    expect(classifyFailure(new MigrationLockError("lock"))).toBe("LOCK_UNAVAILABLE");
    expect(classifyFailure(new MigrationStateError("state"))).toBe("STATE_PERSISTENCE_FAILED");
    expect(classifyFailure(new Error("boom"))).toBe("INTERNAL_ERROR");
  });

  it("requires evidence and an explicit action before resume", () => {
    const checksum = policyFor("CHECKSUM_MISMATCH");
    expect(checksum.requiredEvidence).toEqual(
      expect.arrayContaining(["expected and observed SHA-256"]),
    );
    expect(checksum.operatorAction).toMatch(/Do not upload/);
    const conflict = policyFor("R2_CONFLICT");
    expect(conflict.operatorAction).toMatch(/never overwrite/i);
  });
});
