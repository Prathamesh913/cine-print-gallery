import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cli";

describe("local apply protection", () => {
  it("defaults to dry-run", () => {
    const options = parseCliArgs(["--mode", "ingest"]);
    expect(options.apply).toBe(false);
    expect(options.confirmApply).toBe(false);
    expect(options.limit).toBeNull();
  });

  it("rejects --apply without --confirm-apply", () => {
    expect(() => parseCliArgs(["--mode", "ingest", "--apply", "--limit", "1"])).toThrow(
      /--confirm-apply/,
    );
  });

  it("rejects --confirm-apply without --apply", () => {
    expect(() => parseCliArgs(["--mode", "ingest", "--confirm-apply"])).toThrow(
      /only valid together with --apply/,
    );
  });

  it("rejects --apply without an explicit limit", () => {
    expect(() => parseCliArgs(["--mode", "ingest", "--apply", "--confirm-apply"])).toThrow(
      /explicit --limit/,
    );
  });

  it("allows an explicit single-poster apply", () => {
    const options = parseCliArgs([
      "--mode",
      "ingest",
      "--apply",
      "--confirm-apply",
      "--limit",
      "1",
    ]);
    expect(options).toMatchObject({ apply: true, confirmApply: true, limit: 1 });
  });

  it("rejects an invalid limit even for apply", () => {
    expect(() => parseCliArgs(["--apply", "--confirm-apply", "--limit", "0"])).toThrow(
      /--limit must be positive/,
    );
  });
});
