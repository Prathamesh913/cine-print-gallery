import { describe, expect, it } from "vitest";
import { parseSyncFlags } from "../../scripts/sync-notion-to-firestore.js";

describe("sync CLI identity modes", () => {
  it("defaults to transition with legacy fallback enabled", () => {
    expect(parseSyncFlags([])).toMatchObject({
      identityMode: "transition",
      allowLegacy: true,
      dryRun: false,
      prune: false,
      allowPrune: false,
    });
  });

  it("supports canonical mode with no legacy fallback", () => {
    expect(parseSyncFlags(["--identity-mode=canonical"])).toMatchObject({
      identityMode: "canonical",
      allowLegacy: false,
    });
  });

  it("refuses canonical mode with legacy fallback", () => {
    expect(() => parseSyncFlags(["--identity-mode=canonical", "--allow-legacy"])).toThrow(
      /cannot enable --allow-legacy/,
    );
  });

  it("refuses legacy mode for write runs", () => {
    expect(() => parseSyncFlags(["--identity-mode=legacy"])).toThrow(/dry-run only/);
    expect(parseSyncFlags(["--identity-mode=legacy", "--dry-run"])).toMatchObject({
      identityMode: "legacy",
      allowLegacy: true,
      dryRun: true,
    });
  });

  it("supports explicit prune opt-in and no-legacy", () => {
    expect(parseSyncFlags(["--prune", "--allow-prune", "--no-legacy"])).toMatchObject({
      prune: true,
      allowPrune: true,
      allowLegacy: false,
    });
  });
});
