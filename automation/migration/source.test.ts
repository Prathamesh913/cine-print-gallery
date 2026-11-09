import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  assertSafeSourceUrl,
  buildHttpsRequestOptions,
  createPinnedLookup,
  headersForUrl,
  isPublicAddress,
  readResponseWithLimit,
  resolveAndValidateSourceUrl,
  SourceValidationError,
  type SourceHttpResponse,
} from "./source";

function fakeResponse(
  body: AsyncIterable<Buffer>,
  headers: Record<string, string> = {},
): { response: SourceHttpResponse; state: { destroyed: number } } {
  const state = { destroyed: 0 };
  return {
    state,
    response: {
      status: 200,
      headers,
      body,
      finalUrl: "https://pbs.twimg.com/media/test",
      destroy: () => {
        state.destroyed += 1;
      },
    },
  };
}

describe("F5 — source DNS and SSRF protection", () => {
  it("rejects IPv4 loopback, private, reserved and multicast ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "0.0.0.0",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("1.1.1.1")).toBe(true);
  });

  it("rejects IPv6 loopback, ULA, link-local, documentation and mapped-private addresses", () => {
    for (const address of [
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "2001:db8::1",
      "2001:0000::1",
      "2002:7f00:1::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress("2001:4860:4860::8888")).toBe(true);
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });

  it("rejects a DNS answer containing any private address", async () => {
    await expect(
      resolveAndValidateSourceUrl("https://pbs.twimg.com/media/test", "pbs-twimg", async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toBeInstanceOf(SourceValidationError);
  });

  it("prefers a validated public IPv4 address when DNS returns IPv6 first", async () => {
    const resolved = await resolveAndValidateSourceUrl(
      "https://pbs.twimg.com/media/test",
      "pbs-twimg",
      async () => [
        { address: "2001:4860:4860::8888", family: 6 },
        { address: "8.8.8.8", family: 4 },
      ],
    );
    expect(resolved.pinned).toEqual({ address: "8.8.8.8", family: 4 });
  });

  it("pins the validated address and ignores a later DNS change", async () => {
    let calls = 0;
    const lookup = async () => {
      calls += 1;
      return calls === 1
        ? [{ address: "8.8.8.8", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    };

    const resolved = await resolveAndValidateSourceUrl(
      "https://pbs.twimg.com/media/test",
      "pbs-twimg",
      lookup,
    );
    expect(resolved.pinned.address).toBe("8.8.8.8");

    const pinnedLookup = createPinnedLookup(resolved.pinned.address, resolved.pinned.family)!;
    const callbackResult = await new Promise<unknown>((resolve, reject) => {
      pinnedLookup("pbs.twimg.com", {}, (error, address) => {
        if (error) reject(error);
        else resolve(address);
      });
    });
    expect(callbackResult).toBe("8.8.8.8");

    const second = await lookup();
    expect(second[0].address).toBe("127.0.0.1");
  });

  it("rejects a redirect target that resolves to a private address", async () => {
    await expect(
      resolveAndValidateSourceUrl("https://pbs.twimg.com/media/redirect", "pbs-twimg", async () => [
        { address: "10.0.0.5", family: 4 },
      ]),
    ).rejects.toBeInstanceOf(SourceValidationError);
  });

  it("rejects redirects to unapproved hostnames", () => {
    expect(() => assertSafeSourceUrl("https://evil.example/steal", "pbs-twimg")).toThrow(
      /not allowlisted/,
    );
    expect(() => assertSafeSourceUrl("http://pbs.twimg.com/media/test", "pbs-twimg")).toThrow(
      /HTTPS/,
    );
  });

  it("does not forward the Raindrop token to external or redirected hosts", () => {
    const token = "super-secret-token";
    const raindrop = headersForUrl(
      new URL("https://api.raindrop.io/rest/v1/raindrop/1/file"),
      "raindrop-file",
      token,
    );
    expect(raindrop.Authorization).toBe(`Bearer ${token}`);

    const up = headersForUrl(new URL("https://up.raindrop.io/file"), "raindrop-file", token);
    expect(up.Authorization).toBeUndefined();

    const pbs = headersForUrl(new URL("https://pbs.twimg.com/media/test"), "pbs-twimg", token);
    expect(pbs.Authorization).toBeUndefined();
  });

  it("keeps TLS hostname verification enabled and uses the original hostname", () => {
    const options = buildHttpsRequestOptions(
      new URL("https://pbs.twimg.com/media/test"),
      { Accept: "image/*" },
      { address: "8.8.8.8", family: 4 },
    );
    expect(options.servername).toBe("pbs.twimg.com");
    expect(options.rejectUnauthorized).not.toBe(false);
    expect(typeof options.lookup).toBe("function");
  });
});

describe("F10 — streaming source size limit", () => {
  it("rejects an oversized body with no Content-Length while streaming", async () => {
    const { response, state } = fakeResponse(Readable.from([Buffer.alloc(100)]));
    await expect(readResponseWithLimit(response, 10)).rejects.toBeInstanceOf(SourceValidationError);
    expect(state.destroyed).toBeGreaterThan(0);
  });

  it("rejects an incorrectly small Content-Length when the body is oversized", async () => {
    const { response, state } = fakeResponse(Readable.from([Buffer.alloc(100)]), {
      "content-length": "5",
    });
    await expect(readResponseWithLimit(response, 10)).rejects.toBeInstanceOf(SourceValidationError);
    expect(state.destroyed).toBeGreaterThan(0);
  });

  it("rejects a body that exceeds the limit during streaming", async () => {
    const { response, state } = fakeResponse(Readable.from([Buffer.alloc(8), Buffer.alloc(8)]));
    await expect(readResponseWithLimit(response, 10)).rejects.toBeInstanceOf(SourceValidationError);
    expect(state.destroyed).toBeGreaterThan(0);
  });

  it("accepts a valid body just below the limit", async () => {
    const { response } = fakeResponse(Readable.from([Buffer.alloc(9)]));
    const buffer = await readResponseWithLimit(response, 10);
    expect(buffer.length).toBe(9);
  });

  it("cancels the stream after exceeding the limit", async () => {
    let cancelled = false;
    async function* body() {
      try {
        yield Buffer.alloc(8);
        yield Buffer.alloc(8);
      } finally {
        cancelled = true;
      }
    }
    const { response } = fakeResponse(body());
    await expect(readResponseWithLimit(response, 10)).rejects.toBeInstanceOf(SourceValidationError);
    expect(cancelled).toBe(true);
  });
});
