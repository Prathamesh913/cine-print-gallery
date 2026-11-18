import { describe, expect, it, vi } from "vitest";
import {
  fetchImageDataUrl,
  isPrivateOrLoopbackHost,
  MAX_IMAGE_BYTES,
  MAX_REDIRECTS,
} from "../../src/lib/image-data-url";

/**
 * Regression tripwire for the public image proxy SSRF and buffering defects
 * found in security audit run 1.
 *
 * What happened: the only destination check was a single string comparison on
 * `URL.hostname`. WHATWG URL keeps the brackets on IPv6 literals, so the
 * `"::1"` branch was dead — `[::1]` and `[::ffff:127.0.0.1]` (compressed to
 * `[::ffff:7f00:1]`) dialled loopback. `127.0.0.2`, `100.64.0.0/10` and a
 * trailing-dot `localhost.` also passed, redirects were followed without
 * revalidation, and the body was buffered with no size cap or timeout.
 *
 * Invariant under test: every hop is validated, the destination must be public,
 * and the response is bounded in bytes and time.
 */

const imageResponse = (body: Uint8Array | string = "image-bytes", type = "image/png") =>
  new Response(body as BodyInit, { status: 200, headers: { "content-type": type } });

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

describe("isPrivateOrLoopbackHost", () => {
  it.each([
    "127.0.0.1",
    "127.0.0.2",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "localhost",
    "localhost.",
    "[::1]",
    "::1",
    "[::]",
    "[::ffff:127.0.0.1]",
    "[::ffff:7f00:1]",
    "[::ffff:169.254.169.254]",
    "[fe80::1]",
    "[fd00::1]",
    "[fc00::1]",
    "[fe90::1]",
    "[fec0::1]",
    "[ff02::1]",
    "[::7f00:1]",
    "[64:ff9b::7f00:1]",
  ])("rejects %s", (host) => {
    expect(isPrivateOrLoopbackHost(host)).toBe(true);
  });

  it.each(["example.com", "images.cineprint.click", "8.8.8.8", "1.1.1.1", "[2606:4700::1111]"])(
    "allows %s",
    (host) => {
      expect(isPrivateOrLoopbackHost(host)).toBe(false);
    },
  );
});

describe("fetchImageDataUrl", () => {
  it("refuses loopback and private destinations without calling fetch", async () => {
    const fetchImpl = vi.fn();
    for (const url of [
      "http://127.0.0.1/x.png",
      "http://[::1]/x.png",
      "http://[::ffff:127.0.0.1]/x.png",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost.:8080/x.png",
    ]) {
      await expect(fetchImageDataUrl(url, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
        /Invalid request host/,
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-http protocols and embedded credentials", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchImageDataUrl("ftp://example.com/x.png", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Invalid protocol/);
    await expect(
      fetchImageDataUrl(
        "https://user:pass@example.com/x.png",
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/credentials/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("re-validates redirect targets and refuses a hop to loopback", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return redirect("http://127.0.0.1:8080/internal.png");
    });
    await expect(
      fetchImageDataUrl("https://example.com/start.png", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Invalid request host/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("follows a permitted redirect chain", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (calls.length === 1) return redirect("https://cdn.example.com/final.png");
      return imageResponse();
    });
    const result = await fetchImageDataUrl(
      "https://example.com/start.png",
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(calls).toEqual(["https://example.com/start.png", "https://cdn.example.com/final.png"]);
  });

  it.each([
    ["file:///etc/passwd", /Invalid protocol/],
    ["https://user:pass@example.com/x.png", /credentials/],
  ])("re-validates the redirect target %s", async (location, expected) => {
    const fetchImpl = vi.fn(async () => redirect(location));
    await expect(
      fetchImageDataUrl("https://example.com/start.png", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caps redirect hops", async () => {
    const fetchImpl = vi.fn(async () => redirect("https://example.com/loop.png"));
    await expect(
      fetchImageDataUrl("https://example.com/loop.png", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Too many redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it("rejects a declared body larger than the cap", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("x", {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(MAX_IMAGE_BYTES + 1),
          },
        }),
    );
    await expect(
      fetchImageDataUrl("https://example.com/big.png", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/too large/);
  });

  it("stops reading a stream that crosses the cap", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    const fetchImpl = vi.fn(
      async () => new Response(stream, { status: 200, headers: { "content-type": "image/png" } }),
    );
    await expect(
      fetchImageDataUrl("https://example.com/big.png", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/too large/);
  });

  it("rejects a non-image content type", async () => {
    const fetchImpl = vi.fn(async () => imageResponse("hello", "text/html"));
    await expect(
      fetchImageDataUrl("https://example.com/page", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/content type/);
  });

  it("sets a timeout and manual redirects on the request", async () => {
    const fetchImpl = vi.fn(async (...args: unknown[]) => {
      void args;
      return imageResponse();
    });
    await fetchImageDataUrl("https://example.com/x.png", fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/x.png");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
