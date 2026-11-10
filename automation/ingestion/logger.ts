/**
 * Structured, redacting logs for automation runs.
 *
 * Stdout is reserved for the single machine-readable execution summary; logs go
 * to stderr so a workflow can parse the summary without filtering noise.
 */

import { redactSecrets } from "../migration/source";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  runId: string;
  mode: string;
  dryRun: boolean;
  stream?: Pick<NodeJS.WritableStream, "write">;
  now?: () => Date;
}

function serialize(
  level: LogLevel,
  event: string,
  base: Record<string, unknown>,
  fields: Record<string, unknown> | undefined,
  now: () => Date,
): string {
  const payload = {
    ts: now().toISOString(),
    level,
    ...base,
    event,
    ...(fields ?? {}),
  };

  let line: string;
  try {
    line = JSON.stringify(payload);
  } catch {
    line = JSON.stringify({ ts: payload.ts, level, ...base, event, fields: "[unserializable]" });
  }

  // Defence in depth: no token, Authorization header or credential query value
  // may reach a log sink even if a caller passes a raw error message. The
  // replacements exclude quotes and backslashes so the JSON line stays valid.
  const redacted = line
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization\s*[:=]\s*)[^\s,;"\\]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|access_token|authorization|secret|key)=)[^&\s"\\]+/gi, "$1[REDACTED]");

  return `${redacted}\n`;
}

export function createLogger(options: LoggerOptions): Logger {
  const stream = options.stream ?? process.stderr;
  const now = options.now ?? (() => new Date());

  const build = (base: Record<string, unknown>): Logger => {
    const emit = (level: LogLevel) => (event: string, fields?: Record<string, unknown>) => {
      stream.write(serialize(level, event, base, fields, now));
    };

    return {
      debug: emit("debug"),
      info: emit("info"),
      warn: emit("warn"),
      error: emit("error"),
      child(fields: Record<string, unknown>) {
        return build({ ...base, ...fields });
      },
    };
  };

  return build({
    runId: options.runId,
    mode: options.mode,
    dryRun: options.dryRun,
  });
}

/** Test helper: capture structured log lines without touching process.stderr. */
export function createMemoryLoggerSink(): {
  stream: { write(chunk: string): boolean };
  lines: string[];
} {
  const lines: string[] = [];
  return {
    lines,
    stream: {
      write(chunk: string) {
        lines.push(chunk);
        return true;
      },
    },
  };
}
