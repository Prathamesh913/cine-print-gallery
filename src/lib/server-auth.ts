import { FirebaseAdminError, getAdminAuth } from "../server/firebase/admin";
import { getProjectId } from "./firebase";

// Re-exported so auth-middleware (and future isomorphic wiring) can reference
// the error class without adding a second edge into src/server/firebase.
export { FirebaseAdminError };

export class AuthRequiredError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Verify a Firebase ID token and return the authenticated UID.
 * Throws if the token is missing, invalid, or expired.
 */
export async function verifyTokenUid(token: string): Promise<string> {
  const auth = await getAdminAuth();
  const decoded = await auth.verifyIdToken(token);
  return decoded.uid;
}

/**
 * Require a valid token and return the verified UID.
 *
 * If `claimedUid` is provided and does not match the verified UID, the request
 * is rejected. The returned UID is ALWAYS derived from the verified token and
 * is the only value that should be used for authorization.
 */
export async function requireAuth(
  token?: string | null,
  claimedUid?: string | null,
): Promise<string> {
  if (!token) {
    throw new AuthRequiredError();
  }

  let uid: string;
  try {
    uid = await verifyTokenUid(token);
  } catch (err) {
    // Preserve the underlying cause in server logs so authentication/config
    // failures are observable, while returning only a safe public error.
    const name = err instanceof Error ? err.name : "UnknownError";
    const message = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code)
        : null;
    const wrongProject = /aud|audience/i.test(message);
    console.error(
      "[requireAuth] Firebase ID token verification failed: " +
        JSON.stringify({
          name,
          code,
          stage: err instanceof FirebaseAdminError ? err.stage : "verifyIdToken",
          message,
          projectId: getProjectId() ?? null,
          hint: wrongProject
            ? 'token may have been issued for a different Firebase project (invalid "aud" claim)'
            : null,
        }),
    );
    // Server-side misconfiguration (missing module/credentials) is NOT a user
    // authentication failure: propagate it so it is observable as a 500-class
    // server error instead of masquerading as an expired session.
    if (err instanceof FirebaseAdminError) throw err;
    throw new UnauthorizedError("Invalid or expired session");
  }

  if (claimedUid != null && claimedUid !== uid) {
    throw new UnauthorizedError();
  }
  return uid;
}

/**
 * Like requireAuth but allows unauthenticated callers (used for public reads).
 * Returns the verified UID when a valid token is provided, otherwise null.
 */
export async function maybeAuth(
  token?: string | null,
  claimedUid?: string | null,
): Promise<string | null> {
  if (!token) return null;
  return requireAuth(token, claimedUid);
}

/**
 * Auth resolution for reading a collection (public/unlisted previews may be
 * viewed without a token). A claimed UID without a valid token is rejected.
 */
export async function resolveCollectionViewer(
  token?: string | null,
  claimedUid?: string | null,
): Promise<string | null> {
  if (!token) {
    if (claimedUid != null) {
      throw new UnauthorizedError();
    }
    return null;
  }
  return requireAuth(token, claimedUid);
}
