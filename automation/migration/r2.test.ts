import { describe, expect, it } from "vitest";
import { sha256Hex } from "./checksum";
import { R2_CACHE_CONTROL, R2ConflictError, R2StoreImpl } from "./r2";

const BODY = Buffer.from("metadata-validation-body");
const SHA = sha256Hex(BODY);

function storeWith(metadata: {
  contentType?: string;
  cacheControl?: string;
  sha256?: string;
}) {
  const client = {
    async send() {
      return {
        ContentLength: BODY.length,
        ContentType: metadata.contentType,
        CacheControl: metadata.cacheControl,
        Metadata: { sha256: metadata.sha256 ?? SHA },
        ChecksumSHA256: undefined,
        ETag: '"etag"',
      };
    },
  };

  return new R2StoreImpl({
    accountId: "test",
    accessKeyId: "test",
    secretAccessKey: "test",
    bucket: "test",
    publicBaseUrl: "https://images.cineprint.click",
    client: client as never,
  });
}

const expected = {
  sha256: SHA,
  sizeBytes: BODY.length,
  contentType: "image/png",
  cacheControl: R2_CACHE_CONTROL,
};

describe("F3 — R2 metadata validation", () => {
  it("rejects a missing Content-Type even with a matching checksum", async () => {
    const result = await storeWith({
      contentType: undefined,
      cacheControl: R2_CACHE_CONTROL,
    }).verify("cineprint/external/test.png", expected);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Content-Type");
  });

  it("rejects an incorrect Content-Type even with a matching checksum", async () => {
    const result = await storeWith({
      contentType: "image/jpeg",
      cacheControl: R2_CACHE_CONTROL,
    }).verify("cineprint/external/test.png", expected);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Content-Type");
  });

  it("rejects a missing Cache-Control even with a matching checksum", async () => {
    const result = await storeWith({
      contentType: "image/png",
      cacheControl: undefined,
    }).verify("cineprint/external/test.png", expected);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Cache-Control");
  });

  it("rejects an incorrect Cache-Control even with a matching checksum", async () => {
    const result = await storeWith({
      contentType: "image/png",
      cacheControl: "public, max-age=0",
    }).verify("cineprint/external/test.png", expected);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Cache-Control");
  });

  it("accepts correct checksum and metadata", async () => {
    const result = await storeWith({
      contentType: "image/png",
      cacheControl: R2_CACHE_CONTROL,
    }).verify("cineprint/external/test.png", expected);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("does not weaken checksum validation for metadata-correct objects", async () => {
    const result = await storeWith({
      contentType: "image/png",
      cacheControl: R2_CACHE_CONTROL,
      sha256: "f".repeat(64),
    }).verify("cineprint/external/test.png", expected);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Checksum mismatch");
  });
});

function originStore(input: {
  body?: Buffer;
  contentType?: string;
  cacheControl?: string;
  status?: number;
  etag?: string;
}) {
  const body = input.body ?? BODY;
  const client = {
    async send(command: { constructor: { name: string } }) {
      if (command.constructor.name !== "GetObjectCommand") {
        throw new Error(`Unexpected command: ${command.constructor.name}`);
      }
      if (input.status === 404) {
        const error = new Error("NotFound") as Error & {
          name: string;
          $metadata: { httpStatusCode: number };
        };
        error.name = "NotFound";
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return {
        Body: { transformToByteArray: async () => new Uint8Array(body) },
        ContentLength: body.length,
        ContentType: input.contentType ?? "image/png",
        CacheControl: input.cacheControl ?? R2_CACHE_CONTROL,
        Metadata: { sha256: sha256Hex(body) },
        ETag: input.etag ?? '"etag"',
      };
    },
  };

  return new R2StoreImpl({
    accountId: "test",
    accessKeyId: "test",
    secretAccessKey: "test",
    bucket: "test",
    publicBaseUrl: "https://images.cineprint.click",
    client: client as never,
  });
}

describe("F4 — R2 origin byte verification", () => {
  it("rejects an origin checksum mismatch", async () => {
    const result = await originStore({ body: Buffer.from("different-body") }).verifyOrigin(
      "cineprint/external/test.png",
      expected,
    );
    expect(result.exists).toBe(true);
    expect(result.checksumOk).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("reports a missing origin object", async () => {
    const result = await originStore({ status: 404 }).verifyOrigin(
      "cineprint/external/test.png",
      expected,
    );
    expect(result.exists).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("rejects origin metadata mismatch", async () => {
    const result = await originStore({ contentType: "image/jpeg" }).verifyOrigin(
      "cineprint/external/test.png",
      expected,
    );
    expect(result.checksumOk).toBe(true);
    expect(result.metadataOk).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("accepts successful origin bytes and metadata", async () => {
    const result = await originStore({}).verifyOrigin(
      "cineprint/external/test.png",
      expected,
    );
    expect(result.ok).toBe(true);
    expect(result.checksumOk).toBe(true);
    expect(result.metadataOk).toBe(true);
  });

  it("does not treat ETag as SHA-256", async () => {
    const result = await originStore({
      body: Buffer.from("different-body"),
      etag: `"${SHA}"`,
    }).verifyOrigin("cineprint/external/test.png", expected);
    expect(result.checksumOk).toBe(false);
    expect(result.ok).toBe(false);
  });
});

describe("F8 — conditional writes", () => {
  it("sends If-None-Match: * and maps 412 to a conflict", async () => {
    let sentIfNoneMatch: unknown;
    const client = {
      async send(command: { input: { IfNoneMatch?: unknown } }) {
        sentIfNoneMatch = command.input.IfNoneMatch;
        const error = new Error("PreconditionFailed") as Error & {
          name: string;
          $metadata: { httpStatusCode: number };
        };
        error.name = "PreconditionFailed";
        error.$metadata = { httpStatusCode: 412 };
        throw error;
      },
    };
    const store = new R2StoreImpl({
      accountId: "test",
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "test",
      publicBaseUrl: "https://images.cineprint.click",
      client: client as never,
    });

    await expect(
      store.put({
        key: "cineprint/external/test.png",
        body: BODY,
        contentType: "image/png",
        cacheControl: R2_CACHE_CONTROL,
        metadata: { sha256: SHA },
        sha256: SHA,
      }),
    ).rejects.toBeInstanceOf(R2ConflictError);
    expect(sentIfNoneMatch).toBe("*");
  });
});
