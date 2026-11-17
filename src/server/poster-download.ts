import type { Poster } from "../lib/posters";
import { posterDownloadFilename, POSTER_DOWNLOAD_PATH } from "../lib/download-image";
import { getPosterDownloadSources, type PosterDownloadKind } from "../lib/poster-images";

/**
 * Same-origin download delivery.
 *
 * R2's public domain sends neither Content-Disposition nor CORS headers and a
 * cross-origin `download` attribute is ignored by browsers, so a direct link
 * cannot produce a reliable download. This endpoint re-resolves the poster on
 * the server from the same verified resolver used for rendering — the client
 * supplies only an id and a kind, never a URL or an object key — and streams
 * the bytes back with attachment headers.
 *
 * No request parameter reaches an R2 key or URL directly; keys are never
 * constructed here. Unverifiable identities and missing variants return 404.
 */
export interface PosterDownloadDeps {
  loadCatalogue: () => Promise<Poster[]>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function plainText(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handlePosterDownload(
  request: Request,
  deps: PosterDownloadDeps,
): Promise<Response | null> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.pathname !== POSTER_DOWNLOAD_PATH) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return plainText("Method not allowed", 405);
  }

  const posterId = url.searchParams.get("id");
  const kind = url.searchParams.get("kind");
  if (!posterId || (kind !== "original" && kind !== "optimized")) {
    return plainText("Invalid download request", 400);
  }

  const posters = await deps.loadCatalogue();
  const poster = posters.find((candidate) => candidate.id === posterId);
  if (!poster) return plainText("Poster not found", 404);

  const source = getPosterDownloadSources(poster).find(
    (candidate) => candidate.kind === (kind as PosterDownloadKind),
  );
  if (!source) return plainText("Download unavailable for this poster", 404);

  const upstream = await (deps.fetchImpl ?? fetch)(source.url, {
    signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000),
  });
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => undefined);
    return plainText("Download source unavailable", 502);
  }

  const filename = posterDownloadFilename(poster, source);
  // RFC 5987 for non-ASCII titles, plus a plain ASCII fallback for old clients.
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const headers = new Headers({
    "content-type": source.contentType,
    "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);

  return new Response(request.method === "HEAD" ? null : upstream.body, { headers });
}
