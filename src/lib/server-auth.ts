import { FirebaseAdminError, getAdminAuth } from "../server/firebase/admin";
import { unauthorized } from "../server/errors/app-error";

// Re-exported so auth-middleware (and future isomorphic wiring) can reference
// the error class without adding a second edge into src/server/firebase.
export { FirebaseAdminError };

/**
 * Verify a Firebase ID token and return the authenticated UID.
 * Throws if the token is invalid or expired.
 *
 * This is the ONLY identity source: authMiddleware calls it for authenticated
 * server functions, and optionalViewerUid uses it for public reads. There are
 * no client-declared UID parameters anywhere — a claimed uid field in a
 * payload never reaches verification.
 */
export async function verifyTokenUid(token: string): Promise<string> {
  const auth = await getAdminAuth();
  const decoded = await auth.verifyIdToken(token);
  return decoded.uid;
}

/**
 * Optional-auth viewer resolution for publicly readable resources (Phase 4):
 * null when no token is provided; otherwise the VERIFIED token UID. Identity
 * always comes from the token — there is no claimed-UID parameter.
 *
 * Failure semantics mirror authMiddleware: invalid/expired tokens reject with
 * an AppError UNAUTHORIZED, while FirebaseAdminError (config/module failures)
 * propagates so misconfiguration stays visible as a 5xx-class error.
 */
export async function optionalViewerUid(token?: string | null): Promise<string | null> {
  if (!token) return null;
  try {
    return await verifyTokenUid(token);
  } catch (err) {
    if (err instanceof FirebaseAdminError) throw err;
    throw unauthorized("Invalid or expired session.", { cause: err });
  }
}
