const SUPPORTED_DOWNLOAD_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Hard ceiling on the bytes we will buffer for one image. */
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
/** Redirect hops we will follow, each re-validated. */
export const MAX_REDIRECTS = 3;
/** Upper bound on one outbound request, including the body read. */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Strip the IPv6 brackets and a trailing dot that WHATWG URL keeps in
 * `hostname`, so `[::1]` and `localhost.` are comparable to their bare forms.
 */
function bareHost(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (octets.some((o) => o < 0 || o > 255)) return true; // malformed: fail closed
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

/**
 * True when the host is a loopback, link-local, private, CGNAT or otherwise
 * non-public destination that a public fetch must never dial.
 *
 * The predicate runs on the URL's `hostname`, which for IPv6 literals keeps the
 * brackets and compresses IPv4-mapped addresses (`[::ffff:7f00:1]`), so both
 * forms are normalised before comparison. DNS resolution is not performed here;
 * `assertSafeImageUrl` is re-applied to every redirect hop, and callers that
 * need rebinding protection must also pin the resolved address.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = bareHost(hostname);

  // IPv6
  if (host === "::" || host === "::1") return true;
  if (host.startsWith("fe80:")) return true; // link-local fe80::/10
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true; // unique local fc00::/7
  if (host.startsWith("::ffff:")) {
    const mapped = host.slice("::ffff:".length);
    const dotted = mapped.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (dotted) return isPrivateIPv4(dotted.slice(1).map(Number));
    const hex = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateIPv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
    }
    return true; // unparsable mapped form: fail closed
  }

  // IPv4 and names
  if (host === "localhost") return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return isPrivateIPv4(v4.slice(1).map(Number));
  return false;
}

function assertSafeImageUrl(raw: string | URL): URL {
  let parsed: URL;
  try {
    parsed = raw instanceof URL ? raw : new URL(raw);
  } catch {
    throw new Error("Invalid image URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Invalid protocol. Only http/https images are permitted.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Image URLs must not embed credentials.");
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error("Invalid request host.");
  }
  return parsed;
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new Error("Image response is too large");
  }

  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("Image response is too large");
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Image response is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/**
 * Fetch a public image URL and return a data URI. Server-only.
 *
 * Every hop is validated: the first URL and each redirect target pass
 * `assertSafeImageUrl`, redirects are followed manually with a hop cap, the
 * body is streamed against a byte cap, and the request carries a timeout. The
 * automation downloader (automation/ingestion/download.ts) enforces the same
 * invariants; keep them in step.
 */
export async function fetchImageDataUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let current = assertSafeImageUrl(url);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("Redirect without a location");
      if (hop === MAX_REDIRECTS) throw new Error("Too many redirects");
      current = assertSafeImageUrl(new URL(location, current));
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch image: HTTP ${response.status}`);
    }

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!SUPPORTED_DOWNLOAD_IMAGE_TYPES.has(contentType)) {
      throw new Error(`Unexpected image content type: ${contentType || "unknown"}`);
    }

    const bytes = await readBounded(response);
    if (bytes.byteLength === 0) throw new Error("Image response was empty");

    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  }

  throw new Error("Too many redirects");
}
