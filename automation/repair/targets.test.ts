import { describe, expect, it } from "vitest";
import { REPAIR_TARGETS, RepairTargetError, selectRepairTargets } from "./targets";
import { parseRepairArgs } from "./cli";

describe("scoped repair targets", () => {
  it("contains the two confirmed posters with exact source metadata", () => {
    expect(REPAIR_TARGETS["the-substance-2"]).toMatchObject({
      artist: "Eileen Steinbach",
      sourceUrl: "https://pbs.twimg.com/media/HMtwlGHXgAAYt0L?format=jpg&name=medium",
      expectedSha256: "7235e3b6206fb71c761af2df87540ca3a7735cf7fb0dadadbb62e446cb029d3d",
      expectedDimensions: { width: 690, height: 1024 },
      expectedSizeBytes: 77_278,
      raindropId: "1786264374",
    });
    expect(REPAIR_TARGETS["stranger-things-2"]).toMatchObject({
      artist: "Butcher Billy",
      sourceUrl: "https://pbs.twimg.com/media/G9gZV6dWEAAOjjU?format=jpg&name=4096x4096",
      expectedSha256: "303277e83081b273e0ea271bccba7d3a9bed17a8a9227903cec51ede078ee25b",
      expectedDimensions: { width: 2473, height: 3297 },
      expectedSizeBytes: 2_728_405,
      raindropId: "1521167165",
    });
  });

  it("resolves an exact allowlist in request order", () => {
    expect(
      selectRepairTargets(["stranger-things-2", "the-substance-2"]).map(
        (target) => target.posterId,
      ),
    ).toEqual(["stranger-things-2", "the-substance-2"]);
  });

  it("rejects empty, duplicate, unknown and unsupported IDs", () => {
    expect(() => selectRepairTargets([])).toThrow(RepairTargetError);
    expect(() => selectRepairTargets(["the-substance-2", "the-substance-2"])).toThrow(
      /Duplicate poster ID/,
    );
    expect(() => selectRepairTargets(["not-a-poster"])).toThrow(/Unsupported poster ID/);
    expect(() => selectRepairTargets(["the-substance-1"])).toThrow(/Unsupported poster ID/);
    expect(() => selectRepairTargets([" "])).toThrow(/must not be empty/);
  });
});

describe("repair CLI parsing", () => {
  it("defaults to dry-run and requires --posters", () => {
    expect(parseRepairArgs(["--posters", "the-substance-2,stranger-things-2"])).toEqual({
      posterIds: ["the-substance-2", "stranger-things-2"],
      execute: false,
      auditPath: null,
    });
    expect(() => parseRepairArgs([])).toThrow(/--posters is required/);
  });

  it("only enables writes with explicit --execute", () => {
    const parsed = parseRepairArgs([
      "--posters",
      "the-substance-2,stranger-things-2",
      "--execute",
      "--audit",
      "/tmp/audit.jsonl",
    ]);
    expect(parsed.execute).toBe(true);
    expect(parsed.auditPath).toBe("/tmp/audit.jsonl");
  });

  it("rejects unknown options and missing values", () => {
    expect(() => parseRepairArgs(["--posters", "the-substance-2", "--write"])).toThrow(
      /Unknown option/,
    );
    expect(() => parseRepairArgs(["--posters"])).toThrow(/requires a value/);
  });
});
