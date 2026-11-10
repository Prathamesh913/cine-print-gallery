import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ImageDownloadError,
  assertSafeImageUrl,
  downloadSourceImage,
  hasImageSignature,
} from "./download";

const PNG = fs.readFileSync(path.resolve(__dirname, "../blob/fixtures/test-image.png"));

function imageResponse(contentType = "image/png", body: Buffer = PNG) {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { "content-type": contentType, "content-length": String(body.length) },
  });
}

describe("source image download", () => {
  it("downloads and hashes a valid image", async () => {
    const fetchImpl = vi.fn(async () => imageResponse());
    const result = await downloadSourceImage("https://example.com/poster.png", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.contentType).toBe("image/png");
    expect(result.buffer.length).toBe(PNG.length);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rewrites Raindrop v2 file URLs to the authenticated REST endpoint", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
      calls.push(String(url));
      return imageResponse();
    });

    await downloadSourceImage("https://api.raindrop.io/v2/raindrop/123/file?type=image/png", {
      authToken: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(calls[0]).toBe("https://api.raindrop.io/rest/v1/raindrop/123/file");
  });

  it("rejects non-HTTPS and credentialed URLs", async () => {
    expect(() => assertSafeImageUrl("http://example.com/a.png")).toThrow(ImageDownloadError);
    expect(() => assertSafeImageUrl("https://user:pass@example.com/a.png")).toThrow(
      ImageDownloadError,
    );
  });

  it("rejects loopback and private hosts", () => {
    for (const host of [
      "https://localhost/a.png",
      "https://127.0.0.1/a.png",
      "https://10.1.2.3/a.png",
      "https://192.168.1.1/a.png",
      "https://[::1]/a.png",
    ]) {
      expect(() => assertSafeImageUrl(host)).toThrow(ImageDownloadError);
    }
  });

  it("rejects an unsupported content type", async () => {
    const fetchImpl = vi.fn(async () => imageResponse("image/svg+xml", Buffer.from("<svg/>")));
    await expect(
      downloadSourceImage("https://example.com/a.svg", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("unsupported image content type");
  });

  it("rejects a body that does not match its declared content type", async () => {
    const fetchImpl = vi.fn(async () => imageResponse("image/png", Buffer.from("not a png")));
    await expect(
      downloadSourceImage("https://example.com/a.png", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("does not match its content type");
  });

  it("rejects a declared length above the byte cap", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array(PNG), {
          status: 200,
          headers: { "content-type": "image/png", "content-length": String(PNG.length + 1) },
        }),
    );
    await expect(
      downloadSourceImage("https://example.com/a.png", {
        maxBytes: PNG.length,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("byte limit");
  });

  it("follows a safe redirect", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/a.png" },
        });
      }
      return imageResponse();
    });

    const result = await downloadSourceImage("https://example.com/a.png", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.finalUrl).toBe("https://cdn.example.com/a.png");
    expect(call).toBe(2);
  });

  it("refuses an unsafe redirect", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "http://127.0.0.1/a.png" } }),
    );

    await expect(
      downloadSourceImage("https://example.com/a.png", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(ImageDownloadError);
  });

  it("times out with a retryable error", async () => {
    const fetchImpl = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    await expect(
      downloadSourceImage("https://example.com/a.png", {
        timeoutMs: 5,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ retryable: true });

    expect(hasImageSignature(PNG, "image/png")).toBe(true);
  });
});

function redirectTo(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}

function recordingFetch(responses: Array<Response | (() => Response)>) {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({ url: String(url), authorization: headers.get("authorization") });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return typeof next === "function" ? next() : next;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests };
}

describe("Raindrop authorization isolation", () => {
  it("sends the token to the exact Raindrop API origin", async () => {
    const { fetchImpl, requests } = recordingFetch([imageResponse()]);

    await downloadSourceImage("https://api.raindrop.io/v2/raindrop/123/file?type=image/png", {
      authToken: "raindrop-secret",
      fetchImpl,
    });

    expect(requests[0].authorization).toBe("Bearer raindrop-secret");
  });

  it("never sends the token to an external URL that merely contains the API hostname", async () => {
    const { fetchImpl, requests } = recordingFetch([imageResponse()]);

    await downloadSourceImage("https://evil.example/api.raindrop.io/poster.png", {
      authToken: "raindrop-secret",
      fetchImpl,
    });

    expect(requests[0].authorization).toBeNull();
  });

  it("strips the token when a trusted Raindrop response redirects to an attacker", async () => {
    const { fetchImpl, requests } = recordingFetch([
      redirectTo("https://attacker.example/steal.png"),
      imageResponse(),
    ]);

    const result = await downloadSourceImage(
      "https://api.raindrop.io/v2/raindrop/123/file?type=image/png",
      { authToken: "raindrop-secret", fetchImpl },
    );

    expect(requests).toHaveLength(2);
    expect(requests[0].authorization).toBe("Bearer raindrop-secret");
    expect(requests[1].authorization).toBeNull();
    expect(result.finalUrl).toBe("https://attacker.example/steal.png");
  });

  it("does not trust a hostname that contains raindrop.io as a substring", async () => {
    for (const target of [
      "https://api.raindrop.io.attacker.example/steal.png",
      "https://not-api.raindrop.io.attacker.example/steal.png",
      "https://raindrop.io.attacker.example/steal.png",
    ]) {
      const { fetchImpl, requests } = recordingFetch([redirectTo(target), imageResponse()]);
      await downloadSourceImage("https://api.raindrop.io/rest/v1/raindrop/123/file", {
        authToken: "raindrop-secret",
        fetchImpl,
      });
      expect(requests[1].authorization).toBeNull();
    }
  });

  it("keeps authorization on a redirect that stays on the exact trusted origin", async () => {
    const { fetchImpl, requests } = recordingFetch([
      redirectTo("https://api.raindrop.io/rest/v1/raindrop/123/file?v=2"),
      imageResponse(),
    ]);

    await downloadSourceImage("https://api.raindrop.io/rest/v1/raindrop/123/file", {
      authToken: "raindrop-secret",
      fetchImpl,
    });

    expect(requests[0].authorization).toBe("Bearer raindrop-secret");
    expect(requests[1].authorization).toBe("Bearer raindrop-secret");
  });

  it("reattaches authorization only after an untrusted hop returns to the trusted origin", async () => {
    const { fetchImpl, requests } = recordingFetch([
      redirectTo("https://cdn.example.com/a.png"),
      redirectTo("https://api.raindrop.io/rest/v1/raindrop/123/file"),
      imageResponse(),
    ]);

    await downloadSourceImage("https://api.raindrop.io/rest/v1/raindrop/123/file", {
      authToken: "raindrop-secret",
      fetchImpl,
    });

    expect(requests.map((request) => request.authorization)).toEqual([
      "Bearer raindrop-secret",
      null,
      "Bearer raindrop-secret",
    ]);
  });

  it("rejects a protocol downgrade before making the next request", async () => {
    const { fetchImpl, requests } = recordingFetch([
      redirectTo("http://api.raindrop.io/rest/v1/raindrop/123/file"),
    ]);

    await expect(
      downloadSourceImage("https://api.raindrop.io/rest/v1/raindrop/123/file", {
        authToken: "raindrop-secret",
        fetchImpl,
      }),
    ).rejects.toThrow("must use HTTPS");
    expect(requests).toHaveLength(1);
  });

  it("rejects a redirect to an unexpected port before making the next request", async () => {
    const { fetchImpl, requests } = recordingFetch([
      redirectTo("https://api.raindrop.io:8443/rest/v1/raindrop/123/file"),
    ]);

    await expect(
      downloadSourceImage("https://api.raindrop.io/rest/v1/raindrop/123/file", {
        authToken: "raindrop-secret",
        fetchImpl,
      }),
    ).rejects.toThrow("default HTTPS port");
    expect(requests).toHaveLength(1);
  });

  it("rejects an initial URL with an unexpected port", () => {
    expect(() => assertSafeImageUrl("https://api.raindrop.io:8443/a.png")).toThrow(
      "default HTTPS port",
    );
  });

  it("does not leak the token through multiple redirect hops", async () => {
    const { fetchImpl, requests } = recordingFetch([
      redirectTo("https://api.raindrop.io/rest/v1/raindrop/123/file?one=1"),
      redirectTo("https://attacker.example/two.png"),
      redirectTo("https://another.example/three.png"),
      imageResponse(),
    ]);

    await downloadSourceImage("https://api.raindrop.io/rest/v1/raindrop/123/file", {
      authToken: "raindrop-secret",
      fetchImpl,
    });

    expect(requests.map((request) => request.authorization)).toEqual([
      "Bearer raindrop-secret",
      "Bearer raindrop-secret",
      null,
      null,
    ]);
  });
});
