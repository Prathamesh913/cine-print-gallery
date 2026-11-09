import crypto from "node:crypto";
import path from "node:path";
import type { CliFlags } from "./cli-args";
import { MigrationObservabilityError } from "./failures";
import { FileSink } from "./logger";
import { RunObserver } from "./observer";

export function defaultRunId(): string {
  return `run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

export function defaultBatchId(posterIds: string[]): string {
  const hash = crypto
    .createHash("sha256")
    .update([...posterIds].sort().join("\n"))
    .digest("hex")
    .slice(0, 12);
  return `batch-${hash}`;
}

export interface CliObserverInput {
  flags: Pick<CliFlags, "runId" | "batchId" | "auditPath" | "logFile">;
  plannedPosterIds: string[];
  evidence: "live_migration" | "live_preflight";
  rootDirectory?: string;
}

/** The CLI and its smoke test share this exact observer factory. */
export function createCliObserver(input: CliObserverInput): RunObserver {
  const runId = input.flags.runId ?? defaultRunId();
  const batchId = input.flags.batchId ?? defaultBatchId(input.plannedPosterIds);
  const root = input.rootDirectory ?? process.cwd();
  const auditPath = input.flags.auditPath
    ? path.resolve(root, input.flags.auditPath)
    : path.resolve(root, "migration", "audit", `${runId}.jsonl`);
  const logSinks = input.flags.logFile
    ? [new FileSink(path.resolve(root, input.flags.logFile))]
    : [];
  return new RunObserver({
    runId,
    batchId,
    evidence: input.evidence,
    auditPath,
    plannedPosterIds: input.plannedPosterIds,
    logSinks,
  });
}

export interface ObservedBatchInput<T> {
  observer: RunObserver;
  withLock: (operation: () => Promise<T>) => Promise<T>;
  execute: () => Promise<T>;
}

/**
 * Runs a batch under the existing migration lock while emitting lock lifecycle
 * events. The engine itself emits run/batch/poster events through the observer.
 */
export async function runObservedBatch<T>(input: ObservedBatchInput<T>): Promise<T> {
  let lockAcquired = false;
  let result: T | undefined;
  let operationError: unknown;

  try {
    result = await input.withLock(async () => {
      input.observer.record({
        type: "lock.acquired",
        outcome: "completed",
        operation: "lock",
      });
      lockAcquired = true;
      return input.execute();
    });
  } catch (error) {
    operationError = error;
  }

  if (lockAcquired) {
    try {
      input.observer.record({
        type: "lock.released",
        outcome: "completed",
        operation: "lock",
      });
    } catch (observabilityError) {
      if (operationError !== undefined) {
        throw new MigrationObservabilityError(operationError, observabilityError);
      }
      throw observabilityError;
    }
  } else if (operationError !== undefined) {
    try {
      input.observer.record({
        type: "lock.rejected",
        outcome: "rejected",
        operation: "lock",
        failureCategory: "LOCK_UNAVAILABLE",
        retryable: false,
        message: operationError instanceof Error ? operationError.message : String(operationError),
      });
    } catch (observabilityError) {
      throw new MigrationObservabilityError(operationError, observabilityError);
    }
  }

  if (operationError !== undefined) throw operationError;
  return result as T;
}

/** Closes the observer, preserving the original operation error if cleanup fails. */
export async function withObserver<T>(
  observer: RunObserver,
  operation: () => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }

  try {
    observer.close();
  } catch (closeError) {
    if (operationError !== undefined) {
      throw new MigrationObservabilityError(operationError, closeError);
    }
    throw closeError;
  }

  if (operationError !== undefined) throw operationError;
  return result as T;
}
