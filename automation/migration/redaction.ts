const SENSITIVE_QUERY_PARAMS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "authorization",
  "auth",
  "secret",
  "client_secret",
  "api_key",
  "apikey",
  "key",
  "sig",
  "signature",
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
  "password",
  "passwd",
  "session",
  "cookie",
]);

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-raindrop-token",
]);

const MAX_STRING_LENGTH = 4_000;
const MAX_DEPTH = 8;

function redactQueryString(query: string): string {
  if (!query) return query;
  const params = new URLSearchParams(query);
  let sensitive = false;
  for (const key of params.keys()) {
    if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
      sensitive = true;
      break;
    }
  }
  if (sensitive) return "[REDACTED]";
  return params.toString();
}

export function redactUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    const [pathPart] = value.split("?");
    return value.includes("?") ? `${pathPart}?[REDACTED]` : pathPart;
  }
  const auth = url.username || url.password ? "[REDACTED]@" : "";
  const query = redactQueryString(url.search.replace(/^\?/, ""));
  const suffix = query ? `?${query}` : "";
  return `${url.protocol}//${auth}${url.host}${url.pathname}${suffix}`;
}

function looksLikeBase64(value: string): boolean {
  if (value.length < 200) return false;
  if (/\s/.test(value)) return false;
  return /^[A-Za-z0-9+/=_-]+$/.test(value);
}

export function redactString(value: string): string {
  let output = value
    .replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g, "[BINARY_REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]")
    .replace(
      /((?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /([?&](?:token|access_token|refresh_token|id_token|authorization|secret|api_key|apikey|key|sig|signature|password|session)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /((?:NOTION[_.\- ]?KEY|FIREBASE[_.\- ]?PRIVATE[_.\- ]?KEY|AWS[_.\- ]?SECRET[_.\- ]?ACCESS[_.\- ]?KEY|CLOUDFLARE[_.\- ]?API[_.\- ]?TOKEN|R2[_.\- ]?SECRET[_.\- ]?ACCESS[_.\- ]?KEY|VERCEL[_.\- ]?OIDC[_.\- ]?TOKEN|API[_.\- ]?KEY|ACCESS[_.\- ]?TOKEN|CLIENT[_.\- ]?SECRET|PASSWORD)\s*[:=]\s*)(?:"|')?[^"'\s,;]+/gi,
      "$1[REDACTED]",
    );

  // Replace absolute URLs that still carry a query string, keeping the
  // diagnostic host/path but dropping potentially signed parameters.
  output = output.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => redactUrl(match));

  if (looksLikeBase64(output)) output = "[BASE64_REDACTED]";
  if (output.length > MAX_STRING_LENGTH) {
    output = `${output.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]`;
  }
  return output;
}

export function redactHeaders(headers: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    result[key] = SENSITIVE_HEADER_NAMES.has(normalized)
      ? "[REDACTED]"
      : redactString(String(value));
  }
  return result;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return `[BINARY ${value.length} bytes]`;
  if (value instanceof Uint8Array) return `[BINARY ${value.length} bytes]`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactValue(item, depth + 1);
    }
    return result;
  }
  return "[UNSUPPORTED]";
}

export function redactJson(value: unknown): string {
  return JSON.stringify(redactValue(value));
}
