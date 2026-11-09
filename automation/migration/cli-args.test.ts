import { describe, expect, it } from "vitest";
import { parseFlags, selectEntries, validateCommandFlags, type CliFlags } from "./cli-args";
import { loadManifest } from "./manifest";

const manifest = loadManifest("migration/poster-manifest.json");

function flags(overrides: Partial<CliFlags> = {}): CliFlags {
  return {
    execute: false,
    all: false,
    posters: null,
    breakLock: false,
    concurrency: 3,
    manifestPath: "",
    snapshotPath: "",
    approvalsPath: "",
    statePath: "",
    reportPath: "",
    retryConflicts: false,
    retrySourceChanged: false,
    auditPath: null,
    runId: null,
    batchId: null,
    logFile: null,
    ...overrides,
  };
}

describe("F2 — CLI scope isolation", () => {
  it("parses --all and --posters explicitly", () => {
    expect(parseFlags(["--execute", "--all"]).all).toBe(true);
    expect(parseFlags(["--posters", "a,b"]).posters).toEqual(["a", "b"]);
  });

  it("parses audit, run, batch and log-file flags", () => {
    const parsed = parseFlags([
      "--audit",
      "audit.jsonl",
      "--run-id",
      "run-1",
      "--batch-id",
      "batch-1",
      "--log-file",
      "run.log",
    ]);
    expect(parsed.auditPath).toBe("audit.jsonl");
    expect(parsed.runId).toBe("run-1");
    expect(parsed.batchId).toBe("batch-1");
    expect(parsed.logFile).toBe("run.log");
  });

  it("rejects audit flags for dry-run", () => {
    expect(() =>
      validateCommandFlags("dry-run", flags({ auditPath: "audit.jsonl" }), manifest),
    ).toThrow(/not valid for dry-run/);
  });

  it("run --execute --posters selects only those posters", () => {
    const selection = validateCommandFlags(
      "run",
      flags({
        execute: true,
        posters: ["2001-a-space-odyssey", "bugonia"],
      }),
      manifest,
    );
    expect(selection.selectedPosterIds).toEqual(["2001-a-space-odyssey", "bugonia"]);
    expect(selection.selectedPosterIds).toHaveLength(2);
    expect(selectEntries(manifest, selection.selectedPosterIds ?? [])).toHaveLength(2);
  });

  it("run --execute --all selects all 63 posters", () => {
    const selection = validateCommandFlags("run", flags({ execute: true, all: true }), manifest);
    expect(selection.selectedPosterIds).toHaveLength(63);
    expect(new Set(selection.selectedPosterIds).size).toBe(63);
  });

  it("run without --execute fails closed", () => {
    expect(() => validateCommandFlags("run", flags({ posters: ["bugonia"] }), manifest)).toThrow(
      /requires --execute/,
    );
  });

  it("run without --all or --posters fails closed", () => {
    expect(() => validateCommandFlags("run", flags({ execute: true }), manifest)).toThrow(
      /exactly one of --all or --posters/,
    );
  });

  it("run with both --all and --posters fails closed", () => {
    expect(() =>
      validateCommandFlags(
        "run",
        flags({ execute: true, all: true, posters: ["bugonia"] }),
        manifest,
      ),
    ).toThrow(/not both/);
  });

  it("rejects duplicate and unknown poster IDs before execution", () => {
    expect(() =>
      validateCommandFlags(
        "canary",
        flags({ execute: true, posters: ["bugonia", "bugonia"] }),
        manifest,
      ),
    ).toThrow(/Duplicate poster IDs/);

    expect(() =>
      validateCommandFlags(
        "canary",
        flags({ execute: true, posters: ["not-a-real-poster"] }),
        manifest,
      ),
    ).toThrow(/Unknown poster IDs/);
  });

  it("canary does not accept --all", () => {
    expect(() => validateCommandFlags("canary", flags({ all: true }), manifest)).toThrow(
      /does not accept --all/,
    );
  });

  it("canary selection is exactly the requested IDs", () => {
    const selection = validateCommandFlags(
      "canary",
      flags({ execute: true, posters: ["bugonia"] }),
      manifest,
    );
    expect(selection.selectedPosterIds).toEqual(["bugonia"]);
    expect(selectEntries(manifest, selection.selectedPosterIds ?? [])).toHaveLength(1);
  });

  it("allows --break-lock only for execute runs", () => {
    expect(() =>
      validateCommandFlags("canary", flags({ breakLock: true, posters: ["bugonia"] }), manifest),
    ).toThrow(/requires --execute/);

    expect(() => validateCommandFlags("dry-run", flags({ breakLock: true }), manifest)).toThrow(
      /only valid for canary\/run/,
    );

    expect(() =>
      validateCommandFlags("run", flags({ execute: true, all: true, breakLock: true }), manifest),
    ).not.toThrow();
  });

  it("dry-run and verify reject poster selection", () => {
    expect(() =>
      validateCommandFlags("dry-run", flags({ posters: ["bugonia"] }), manifest),
    ).toThrow(/does not support poster selection/);
    expect(() => validateCommandFlags("verify", flags({ all: true }), manifest)).toThrow(
      /does not support poster selection/,
    );
  });
});
