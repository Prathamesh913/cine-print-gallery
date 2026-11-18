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
  if (octets.length !== 4 || octets.some((o) => o < 0 || o > 255)) return true; // malformed: fail closed
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

/** Expand an IPv6 literal (including a trailing dotted quad) to 16 bytes. */
function parseIPv6(host: string): number[] | null {
  let text = host;
  const dotted = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted && dotted.index !== undefined) {
    const parts = dotted[1].split(".").map(Number);
    if (parts.some((part) => part < 0 || part > 255)) return null;
    const hi = (parts[0] << 8) | parts[1];
    const lo = (parts[2] << 8) | parts[3];
    text = text.slice(0, dotted.index) + hi.toString(16) + ":" + lo.toString(16);
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };
  const left = groups(halves[0]);
  const right = halves.length === 2 ? groups(halves[1]) : [];
  if (!left || !right) return null;
  const used = left.length + right.length;
  if (halves.length === 1 ? used !== 8 : used >= 8) return null;
  const expanded = halves.length === 2 ? [...left, ...Array(8 - used).fill(0), ...right] : left;
  const bytes: number[] = [];
  for (const group of expanded) bytes.push(group >> 8, group & 0xff);
  return bytes;
}

function isPrivateIPv6(bytes: number[]): boolean {
  if (bytes.slice(0, 15).every((byte) => byte === 0) && (bytes[15] === 0 || bytes[15] === 1)) {
    return true; // :: and ::1
  }
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateIPv4(bytes.slice(12)); // IPv4-mapped ::ffff:a.b.c.d
  }
  if (bytes.slice(0, 12).every((byte) => byte === 0)) {
    return isPrivateIPv4(bytes.slice(12)); // IPv4-compatible ::a.b.c.d
  }
  if (
    bytes[0] === 0 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  ) {
    return isPrivateIPv4(bytes.slice(12)); // NAT64 64:ff9b::/96
  }
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast
  return false;
}

/**
 * True when the host is a loopback, link-local, private, CGNAT or otherwise
 * non-public destination that a public fetch must never dial.
 *
 * DNS resolution is not performed here: a hostname that resolves to a private
 * address is not detected by this predicate. Redirects re-run the check on
 * every hop; callers that need rebinding protection must also pin the resolved
 * address.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = bareHost(hostname);

  if (host.includes(":")) {
    const bytes = parseIPv6(host);
    return bytes === null ? true : isPrivateIPv6(bytes); // malformed: fail closed
  }

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
