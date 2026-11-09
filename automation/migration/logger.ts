import fs from "node:fs";
import path from "node:path";
import { assertValidEvent, createEvent, type EventDraft, type MigrationEvent } from "./events";
import { redactString, redactValue } from "./redaction";

export class LogSinkError extends Error {
  constructor(
    message: string,
    readonly sink: string,
    readonly cause: unknown,
  ) {
    super(message);
  }
}

export interface LogSink {
  readonly name: string;
  write(line: string): void | Promise<void>;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

export class ConsoleSink implements LogSink {
  readonly name = "console";

  constructor(
    private readonly writeLine: (line: string) => void = (line) => {
      process.stdout.write(`${line}\n`);
    },
  ) {}

  write(line: string): void {
    this.writeLine(line);
  }
}

export class FileSink implements LogSink {
  readonly name: string;
  private fd: number | null;

  constructor(private readonly filePath: string) {
    this.name = `file:${filePath}`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.fd = fs.openSync(filePath, "a", 0o600);
  }

  write(line: string): void {
    if (this.fd === null) throw new LogSinkError("Log file is closed", this.name, null);
    fs.writeSync(this.fd, `${line}\n`);
  }

  flush(): void {
    if (this.fd === null) return;
    fs.fsyncSync(this.fd);
  }

  close(): void {
    if (this.fd === null) return;
    try {
      fs.fsyncSync(this.fd);
    } finally {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

export class MemorySink implements LogSink {
  readonly name: string;
  readonly lines: string[] = [];

  constructor(name = "memory") {
    this.name = name;
  }

  write(line: string): void {
    this.lines.push(line);
  }

  events(): MigrationEvent[] {
    return this.lines.map((line) => JSON.parse(line) as MigrationEvent);
  }
}

export interface StructuredLoggerOptions {
  sinks: LogSink[];
  /** Throw on sink failure (default) or collect and require assertHealthy(). */
  sinkFailurePolicy?: "throw" | "collect";
  onSinkError?: (error: LogSinkError) => void;
}

export interface SinkFailure {
  sink: string;
  message: string;
}

export class StructuredLogger {
  private readonly sinks: LogSink[];
  private readonly policy: "throw" | "collect";
  private readonly onSinkError?: (error: LogSinkError) => void;
  readonly failures: SinkFailure[] = [];

  constructor(options: StructuredLoggerOptions) {
    this.sinks = [...options.sinks];
    this.policy = options.sinkFailurePolicy ?? "throw";
    this.onSinkError = options.onSinkError;
  }

  isHealthy(): boolean {
    return this.failures.length === 0;
  }

  assertHealthy(): void {
    if (this.failures.length === 0) return;
    throw new LogSinkError(
      `Structured logging is unhealthy: ${this.failures
        .map((failure) => `${failure.sink}: ${failure.message}`)
        .join("; ")}`,
      this.failures[0].sink,
      null,
    );
  }

  log(draft: EventDraft): MigrationEvent {
    const event = createEvent(draft);
    return this.logEvent(event);
  }

  logEvent(event: MigrationEvent): MigrationEvent {
    assertValidEvent(event);
    const line = JSON.stringify(redactValue(event));
    for (const sink of this.sinks) {
      try {
        const result = sink.write(line);
        if (result instanceof Promise) {
          // Structured sinks are synchronous in this phase; a promise would
          // otherwise let ordering and durability race. Treat it as an error.
          throw new Error("Async log sinks are not supported");
        }
      } catch (error) {
        const failure: LogSinkError = new LogSinkError(
          `Log sink ${sink.name} failed: ${error instanceof Error ? error.message : String(error)}`,
          sink.name,
          error,
        );
        this.failures.push({ sink: sink.name, message: failure.message });
        this.onSinkError?.(failure);
        if (this.policy === "throw") throw failure;
      }
    }
    return event;
  }

  checkpoint(): void {
    for (const sink of this.sinks) {
      try {
        sink.flush?.();
      } catch (error) {
        const failure = new LogSinkError(
          `Log sink ${sink.name} flush failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          sink.name,
          error,
        );
        this.failures.push({ sink: sink.name, message: failure.message });
        this.onSinkError?.(failure);
        if (this.policy === "throw") throw failure;
      }
    }
  }

  close(): void {
    for (const sink of this.sinks) {
      try {
        sink.close?.();
      } catch (error) {
        const failure = new LogSinkError(
          `Log sink ${sink.name} close failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          sink.name,
          error,
        );
        this.failures.push({ sink: sink.name, message: failure.message });
        this.onSinkError?.(failure);
        if (this.policy === "throw") throw failure;
      }
    }
  }
}

/** Redacts an arbitrary diagnostic payload before it is handed to any sink. */
export function safeLogPayload(value: unknown): string {
  return JSON.stringify(redactValue(value));
}

export function safeLogMessage(value: string): string {
  return redactString(value);
}
