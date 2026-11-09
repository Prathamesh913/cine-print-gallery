const SUPPORTED_DOWNLOAD_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.")
  );
}

/**
 * Fetch a public image URL and return a data URI. This is server-only; it keeps
 * the existing base64 download architecture while rejecting HTML/error bodies
 * and unsupported content types.
 */
export async function fetchImageDataUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid image URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Invalid protocol. Only http/https images are permitted.");
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error("Invalid request host.");
  }

  const response = await fetchImpl(parsed.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch image: HTTP ${response.status}`);
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!contentType.startsWith("image/") || !SUPPORTED_DOWNLOAD_IMAGE_TYPES.has(contentType)) {
    throw new Error(`Unexpected image content type: ${contentType || "unknown"}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error("Image response was empty");
  }

  return `data:${contentType};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
}
