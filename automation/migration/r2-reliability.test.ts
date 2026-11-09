import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./checksum";
import { R2_CACHE_CONTROL, R2StoreImpl, type R2StoreOptions } from "./r2";

const BODY = Buffer.from("bounded-r2-verification-body");
const SHA = sha256Hex(BODY);
const KEY = "cineprint/versions/original/poster-1/" + SHA + ".png";

function storeWithClient(
  client: { send: (...args: never[]) => Promise<unknown> },
  options: Partial<R2StoreOptions> = {},
): R2StoreImpl {
  return new R2StoreImpl({
    accountId: "test",
    accessKeyId: "test",
    secretAccessKey: "test",
    bucket: "test",
    publicBaseUrl: "https://images.cineprint.click",
    client: client as never,
    ...options,
  });
}

function expected() {
  return {
    sha256: SHA,
    sizeBytes: BODY.length,
    contentType: "image/png",
    cacheControl: R2_CACHE_CONTROL,
  };
}

function getObjectClient(body: AsyncIterable<Uint8Array>, contentLength?: number) {
  return {
    async send() {
      return {
        Body: body,
        ContentLength: contentLength,
        ContentType: "image/png",
        CacheControl: R2_CACHE_CONTROL,
        Metadata: { sha256: SHA, "poster-id": "poster-1", variant: "original" },
        ETag: '"etag"',
      };
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F15 — bounded origin verification", () => {
  it("stops reading an oversized streamed body at the expected size", async () => {
    let chunksRead = 0;
    async function* body() {
      for (let index = 0; index < 100; index++) {
        chunksRead += 1;
        yield Buffer.alloc(64, index);
      }
    }
    const result = await storeWithClient(getObjectClient(body(), undefined)).verifyOrigin(
      KEY,
      expected(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/limit/);
    expect(chunksRead).toBeLessThanOrEqual(2);
  });

  it("rejects an oversized Content-Length without reading the body", async () => {
    let read = false;
    async function* body() {
      read = true;
      yield BODY;
    }
    const result = await storeWithClient(getObjectClient(body(), BODY.length + 1)).verifyOrigin(
      KEY,
      expected(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Content-Length/);
    expect(read).toBe(false);
  });

  it("validates required user metadata", async () => {
    const client = {
      async send() {
        return {
          Body: (async function* () {
            yield BODY;
          })(),
          ContentLength: BODY.length,
          ContentType: "image/png",
          CacheControl: R2_CACHE_CONTROL,
          Metadata: { sha256: SHA, "poster-id": "other-poster", variant: "original" },
          ETag: '"etag"',
        };
      },
    };
    const result = await storeWithClient(client).verifyOrigin(KEY, {
      ...expected(),
      userMetadata: { "poster-id": "poster-1", variant: "original" },
    });
    expect(result.ok).toBe(false);
    expect(result.metadataOk).toBe(false);
    expect(result.reason).toMatch(/poster-id/);
  });

  it("accepts matching bytes and metadata", async () => {
    const result = await storeWithClient(
      getObjectClient(
        (async function* () {
          yield BODY;
        })(),
        BODY.length,
      ),
    ).verifyOrigin(KEY, {
      ...expected(),
      userMetadata: { "poster-id": "poster-1", variant: "original" },
    });
    expect(result.ok).toBe(true);
  });
});

function publicFetch(body: Buffer, headers: Record<string, string>, status = 200): typeof fetch {
  return (async () => new Response(body, { status, headers })) as typeof fetch;
}

describe("F15 — bounded public verification and Cache-Control", () => {
  it("accepts a matching body with immutable Cache-Control", async () => {
    vi.stubGlobal(
      "fetch",
      publicFetch(BODY, {
        "content-type": "image/png",
        "content-length": String(BODY.length),
        "cache-control": R2_CACHE_CONTROL,
      }),
    );
    const result = await storeWithClient({ send: async () => ({}) }).publicVerify(
      `https://images.cineprint.click/${KEY}`,
      expected(),
    );
    expect(result.ok).toBe(true);
    expect(result.cacheControl).toBe(R2_CACHE_CONTROL);
  });

  it("rejects a missing Cache-Control header", async () => {
    vi.stubGlobal(
      "fetch",
      publicFetch(BODY, {
        "content-type": "image/png",
        "content-length": String(BODY.length),
      }),
    );
    const result = await storeWithClient({ send: async () => ({}) }).publicVerify(
      `https://images.cineprint.click/${KEY}`,
      expected(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Cache-Control/);
  });

  it("rejects a non-immutable Cache-Control header", async () => {
    vi.stubGlobal(
      "fetch",
      publicFetch(BODY, {
        "content-type": "image/png",
        "content-length": String(BODY.length),
        "cache-control": "public, max-age=0",
      }),
    );
    const result = await storeWithClient({ send: async () => ({}) }).publicVerify(
      `https://images.cineprint.click/${KEY}`,
      expected(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Cache-Control/);
  });

  it("rejects an oversized Content-Length before reading the body", async () => {
    vi.stubGlobal(
      "fetch",
      publicFetch(BODY, {
        "content-type": "image/png",
        "content-length": String(BODY.length + 1),
        "cache-control": R2_CACHE_CONTROL,
      }),
    );
    const result = await storeWithClient({ send: async () => ({}) }).publicVerify(
      `https://images.cineprint.click/${KEY}`,
      expected(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/size mismatch|Content-Length/);
  });

  it("rejects a streamed body that exceeds the limit without Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(BODY.length + 10));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response(stream, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "cache-control": R2_CACHE_CONTROL,
          },
        })) as typeof fetch,
    );
    const result = await storeWithClient({ send: async () => ({}) }).publicVerify(
      `https://images.cineprint.click/${KEY}`,
      expected(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/limit/);
  });

  it("times out a stalled public response and settles", async () => {
    vi.stubGlobal(
      "fetch",
      ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as typeof fetch,
    );
    const started = Date.now();
    const result = await storeWithClient(
      { send: async () => ({}) },
      { publicVerifyTimeoutMs: 20 },
    ).publicVerify(`https://images.cineprint.click/${KEY}`, expected());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/timed out/);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("does not buffer a HEAD-only public check", async () => {
    vi.stubGlobal(
      "fetch",
      publicFetch(Buffer.alloc(0), {
        "content-type": "image/png",
        "content-length": String(BODY.length),
        "cache-control": R2_CACHE_CONTROL,
      }),
    );
    const result = await storeWithClient({ send: async () => ({}) }).publicVerify(
      `https://images.cineprint.click/${KEY}`,
    );
    expect(result.ok).toBe(true);
    expect(result.contentLength).toBe(BODY.length);
  });
});
