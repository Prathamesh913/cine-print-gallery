// Pure helpers for resolving and validating a Firebase service-account JSON.
// Kept free of firebase-admin imports so the parsing/validation is unit-testable
// and never exposes secret values.

export interface ServiceAccount {
  type?: string;
  project_id?: string;
  private_key_id?: string;
  private_key?: string;
  client_email?: string;
  client_id?: string;
  [key: string]: unknown;
}

export type ParseResult = { ok: true; account: ServiceAccount } | { ok: false; error: string };

/**
 * Parse a raw FIREBASE_SERVICE_ACCOUNT_JSON value into an object.
 * The error string never includes the raw input, only a parse reason.
 */
export function parseServiceAccount(raw: string | undefined | null): ParseResult {
  if (!raw || !raw.trim()) {
    return { ok: false, error: "FIREBASE_SERVICE_ACCOUNT_JSON is empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${message}` };
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { ok: true, account: parsed as ServiceAccount };
  }
  return { ok: false, error: "FIREBASE_SERVICE_ACCOUNT_JSON is not a JSON object" };
}

/**
 * Fields the Firebase Admin SDK requires to verify ID tokens and write via the
 * service account. Returns the list of missing fields (empty when usable).
 */
export function missingServiceAccountFields(account: ServiceAccount): string[] {
  const missing: string[] = [];
  if (!account.project_id) missing.push("project_id");
  if (!account.client_email) missing.push("client_email");
  if (!account.private_key) missing.push("private_key");
  return missing;
}
