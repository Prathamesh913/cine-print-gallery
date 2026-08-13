import type { User } from "firebase/auth";

/**
 * Resolve a fresh Firebase ID token for the current user, or null when the user
 * is not authenticated or the token cannot be obtained.
 */
export async function getAuthToken(user: User | null): Promise<string | null> {
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch (err) {
    console.error("Failed to get auth token:", err);
    return null;
  }
}
