import { AuditLog } from "./audit";
import { type EventDraft, type EvidenceMode, type MigrationEvent } from "./events";
import {
  BatchPauseController,
  computeRunSummary,
  type RunSummary,
  type ThresholdConfig,
} from "./health";
import { StructuredLogger, type LogSink } from "./logger";
import type { MigrationResult, MigrationStateEntry } from "./types";

export type ObserverEventDraft = Omit<
  EventDraft,
  "runId" | "batchId" | "evidence" | "sequence" | "eventId" | "timestamp"
> & {
  eventId?: string;
  timestamp?: string;
};

export interface MigrationEventSink {
  record(draft: ObserverEventDraft): MigrationEvent;
  beginPoster(posterId: string): void;
  endPoster(): void;
  checkpoint(): void;
}

export interface RunObserverOptions {
  runId: string;
  batchId?: string;
  evidence: EvidenceMode;
  auditPath: string;
  plannedPosterIds: string[];
  logSinks?: LogSink[];
  thresholds?: ThresholdConfig;
  audit?: AuditLog;
  logger?: StructuredLogger;
  breakAuditLock?: boolean;
}

export class RunObserver implements MigrationEventSink {
  readonly runId: string;
  readonly batchId?: string;
  readonly evidence: EvidenceMode;
  readonly audit: AuditLog;
  readonly logger: StructuredLogger;
  readonly controller: BatchPauseController;
  private readonly plannedPosterIds: string[];

  constructor(options: RunObserverOptions) {
    this.runId = options.runId;
    this.batchId = options.batchId;
    this.evidence = options.evidence;
    this.plannedPosterIds = [...options.plannedPosterIds];
    this.audit =
      options.audit ??
      AuditLog.open({
        path: options.auditPath,
        runId: options.runId,
        breakLock: options.breakAuditLock,
      });
    this.logger =
      options.logger ??
      new StructuredLogger({
        sinks: options.logSinks ?? [],
      });
    this.controller = new BatchPauseController(
      {
        runId: options.runId,
        ...(options.batchId !== undefined ? { batchId: options.batchId } : {}),
        posterIds: options.plannedPosterIds,
      },
      options.thresholds,
    );
  }

  record(draft: ObserverEventDraft): MigrationEvent {
    const event = this.audit.append({
      ...draft,
      runId: this.runId,
      ...(this.batchId !== undefined ? { batchId: this.batchId } : {}),
      evidence: this.evidence,
    });
    this.logger.logEvent(event);
    this.controller.record(event);
    return event;
  }

  beginPoster(posterId: string): void {
    this.controller.beginPoster(posterId);
  }

  endPoster(): void {
    this.controller.endPoster();
  }

  checkpoint(): void {
    this.audit.checkpoint();
    this.logger.checkpoint();
  }

  summary(
    input: {
      results?: MigrationResult[];
      stateEntries?: Record<string, MigrationStateEntry>;
      startedAt?: string;
      completedAt?: string;
      expectedObjects?: number;
      now?: () => Date;
    } = {},
  ): RunSummary {
    const read = this.audit.readAll();
    const fatalIssues = read.issues.filter((issue) => issue.fatal);
    return computeRunSummary({
      runId: this.runId,
      ...(this.batchId !== undefined ? { batchId: this.batchId } : {}),
      evidence: this.evidence,
      plannedPosterIds: this.plannedPosterIds,
      results: input.results,
      stateEntries: input.stateEntries,
      events: read.events,
      expectedObjects: input.expectedObjects,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      now: input.now,
      auditHealthy: fatalIssues.length === 0,
      // Recoverable partial tails are preserved evidence, not corruption.
      auditIssues: fatalIssues.length,
    });
  }

  close(): void {
    try {
      this.checkpoint();
    } finally {
      this.audit.close();
      this.logger.close();
    }
  }
}
