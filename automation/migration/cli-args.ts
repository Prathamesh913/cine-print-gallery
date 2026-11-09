import type { ManifestEntry, PosterManifest } from "./types";

export type Command = "dry-run" | "canary" | "run" | "verify" | "help";

export interface CliFlags {
  execute: boolean;
  all: boolean;
  posters: string[] | null;
  breakLock: boolean;
  concurrency: number;
  manifestPath: string;
  snapshotPath: string;
  approvalsPath: string;
  statePath: string;
  reportPath: string;
  retryConflicts: boolean;
  retrySourceChanged: boolean;
  auditPath: string | null;
  runId: string | null;
  batchId: string | null;
  logFile: string | null;
}

export interface CommandSelection {
  selectedPosterIds: string[] | null;
}

export function parseCommand(value: string | undefined): Command {
  if (!value || value === "help" || value === "--help" || value === "-h") return "help";
  if (value === "dry-run" || value === "canary" || value === "run" || value === "verify") {
    return value;
  }
  throw new Error(`Unknown command: ${value}`);
}

export function parseFlags(args: string[]): CliFlags {
  const flags: CliFlags = {
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
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case "--execute":
        flags.execute = true;
        break;
      case "--all":
        flags.all = true;
        break;
      case "--break-lock":
        flags.breakLock = true;
        break;
      case "--posters":
        flags.posters = next()
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case "--concurrency": {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 1 || value > 8) {
          throw new Error("--concurrency must be an integer between 1 and 8");
        }
        flags.concurrency = value;
        break;
      }
      case "--manifest":
        flags.manifestPath = next();
        break;
      case "--snapshot":
        flags.snapshotPath = next();
        break;
      case "--approvals":
        flags.approvalsPath = next();
        break;
      case "--state":
        flags.statePath = next();
        break;
      case "--report":
        flags.reportPath = next();
        break;
      case "--retry-conflicts":
        flags.retryConflicts = true;
        break;
      case "--retry-source-changed":
        flags.retrySourceChanged = true;
        break;
      case "--audit":
        flags.auditPath = next();
        break;
      case "--run-id":
        flags.runId = next();
        break;
      case "--batch-id":
        flags.batchId = next();
        break;
      case "--log-file":
        flags.logFile = next();
        break;
      case "--help":
      case "-h":
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return flags;
}

export function assertUniquePosterIds(ids: string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate poster IDs are not allowed: ${[...duplicates].join(", ")}`);
  }
}

export function resolvePosterIds(manifest: PosterManifest, ids: string[]): string[] {
  assertUniquePosterIds(ids);
  const known = new Set(manifest.entries.map((entry) => entry.cineprintPosterId));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown poster IDs: ${unknown.join(", ")}`);
  }
  return [...ids];
}

export function selectEntries(manifest: PosterManifest, ids: string[]): ManifestEntry[] {
  const byId = new Map(manifest.entries.map((entry) => [entry.cineprintPosterId, entry]));
  return ids.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`Unknown poster ID: ${id}`);
    return entry;
  });
}

export function validateCommandFlags(
  command: Command,
  flags: CliFlags,
  manifest: PosterManifest,
): CommandSelection {
  if (flags.posters !== null && flags.posters.length === 0) {
    throw new Error("Poster selection is empty");
  }
  if (flags.breakLock && (command === "dry-run" || command === "verify" || command === "help")) {
    throw new Error("--break-lock is only valid for canary/run with --execute");
  }
  if (command === "canary" && flags.breakLock && !flags.execute) {
    throw new Error("--break-lock requires --execute");
  }
  if (command === "dry-run" && (flags.auditPath || flags.runId || flags.batchId || flags.logFile)) {
    throw new Error("--audit, --run-id, --batch-id and --log-file are not valid for dry-run");
  }

  switch (command) {
    case "run": {
      if (!flags.execute) {
        throw new Error(
          "run requires --execute and exactly one of --all or --posters. No writes performed.",
        );
      }
      if (flags.all && flags.posters) {
        throw new Error("run accepts either --all or --posters, not both");
      }
      if (!flags.all && !flags.posters) {
        throw new Error("run requires exactly one of --all or --posters");
      }
      if (flags.all) {
        return { selectedPosterIds: manifest.entries.map((entry) => entry.cineprintPosterId) };
      }
      return { selectedPosterIds: resolvePosterIds(manifest, flags.posters ?? []) };
    }

    case "canary": {
      if (flags.all) {
        throw new Error("canary does not accept --all; use --posters or the default selection");
      }
      if (flags.posters) {
        return { selectedPosterIds: resolvePosterIds(manifest, flags.posters) };
      }
      return { selectedPosterIds: null };
    }

    case "dry-run":
      if (flags.all || flags.posters) {
        throw new Error("dry-run does not support poster selection; it reports the full catalogue");
      }
      return { selectedPosterIds: null };

    case "verify":
      if (flags.all || flags.posters) {
        throw new Error("verify does not support poster selection; it verifies the full catalogue");
      }
      return { selectedPosterIds: null };

    case "help":
      return { selectedPosterIds: null };
  }
}
