import { describe, expect, it } from "vitest";
import { buildRuntime, parseCliArgs } from "./cli";
import { loadPipelineConfig } from "./config";
import { createLogger, createMemoryLoggerSink } from "./logger";
import { DryRunWriteError } from "./read-only";
import type { FirestoreLike } from "./state";

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

const SERVICE_ACCOUNT = '{"project_id":"test","client_email":"test@example.com"}';

function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>> = {}) {
  const collections: Record<string, Record<string, Record<string, unknown>>> = structuredClone(
    seed,
  );

  return {
    collections,
    collection(name: string) {
      collections[name] ??= {};
      const docs = collections[name];
      return {
        doc(id: string) {
          return {
            async get() {
              return { exists: id in docs, data: () => docs[id] };
            },
            async set(data: Record<string, unknown>) {
              docs[id] = data;
              return {};
            },
            async update(data: Record<string, unknown>) {
              docs[id] = { ...docs[id], ...data };
              return {};
            },
          };
        },
        limit(_count: number) {
          return {
            async get() {
              return {
                docs: Object.entries(docs).map(([id, data]) => ({ id, data: () => data })),
              };
            },
          };
        },
      };
    },
  };
}

function config(env: Record<string, string | undefined> = {}) {
  return loadPipelineConfig(
    {
      NOTION_KEY: "notion-secret",
      NOTION_DATABASE_ID: "38c890a5-f3e2-8007-83f8-da7b81a268e4",
      ...env,
    },
    { requireR2: false, requireIngestionSources: false },
  );
}

function logger() {
  return createLogger({
    runId: "run-1",
    mode: "publish",
    dryRun: true,
    stream: createMemoryLoggerSink().stream,
  });
}

describe("dry-run runtime", () => {
  it("reads existing Firestore state when credentials are available", async () => {
    const db = fakeDb({ posters: { "artwork-123": { status: "published" } } });
    const runtime = buildRuntime(
      config({ FIREBASE_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT }),
      parseCliArgs(["--mode", "publish"]),
      logger(),
      { initFirestore: () => db },
    );

    expect(runtime.firestoreAvailable).toBe(true);
    expect((await runtime.catalog.get("artwork-123"))?.data.status).toBe("published");
    expect(await runtime.catalog.listAll()).toHaveLength(1);
    expect(await runtime.jobStore.list()).toEqual([]);
  });

  it("cannot write to Firestore in a dry run", async () => {
    const db = fakeDb({ posters: { "artwork-123": { status: "published" } } });
    const runtime = buildRuntime(
      config({ FIREBASE_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT }),
      parseCliArgs(["--mode", "publish"]),
      logger(),
      { initFirestore: () => db },
    );

    await expect(runtime.catalog.create("artwork-124", {})).rejects.toBeInstanceOf(
      DryRunWriteError,
    );
    await expect(runtime.catalog.update("artwork-123", {})).rejects.toBeInstanceOf(
      DryRunWriteError,
    );
    await expect(runtime.runStore.save({} as never)).rejects.toBeInstanceOf(DryRunWriteError);
    expect(db.collections.posters["artwork-124"]).toBeUndefined();
    expect(db.collections.posters["artwork-123"]).toEqual({ status: "published" });
  });

  it("falls back to empty in-memory state without Firestore credentials", () => {
    const runtime = buildRuntime(config(), parseCliArgs(["--mode", "publish"]), logger(), {
      initFirestore: () => fakeDb(),
    });

    expect(runtime.firestoreAvailable).toBe(false);
  });

  it("keeps apply runs write-capable and credential-gated", async () => {
    expect(() =>
      buildRuntime(
        config(),
        parseCliArgs(["--mode", "publish", "--apply", "--confirm-apply", "--limit", "1"]),
        logger(),
        { initFirestore: () => fakeDb() },
      ),
    ).toThrow(/FIREBASE_SERVICE_ACCOUNT_JSON is required/);

    const db = fakeDb();
    const runtime = buildRuntime(
      config({ FIREBASE_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT }),
      parseCliArgs(["--mode", "publish", "--apply", "--confirm-apply", "--limit", "1"]),
      logger(),
      { initFirestore: () => db as unknown as FirestoreLike },
    );

    await runtime.catalog.create("artwork-124", { status: "published" });
    expect(db.collections.posters["artwork-124"]).toMatchObject({ status: "published" });
  });
});
