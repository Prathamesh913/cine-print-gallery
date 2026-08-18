import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User, Auth } from "firebase/auth";
import { toast } from "sonner";
import { initializeAuthSession } from "./auth-initialization";

export type SignInResult =
  | { ok: true }
  | { ok: false; code: string; message: string; redirecting?: boolean };

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signingIn: boolean;
  signInWithGoogle: () => Promise<SignInResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function messageForAuthCode(code: string, fallback?: string): string {
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was cancelled. You can try again when you're ready.";
    case "auth/popup-blocked":
      return "Pop-up was blocked. Allow pop-ups for this site, or try again.";
    case "auth/operation-not-allowed":
      return "Google sign-in is temporarily unavailable. Please try again later.";
    case "auth/unauthorized-domain":
      return "This domain isn't authorized for sign-in yet.";
    case "auth/configuration-not-found":
      return "Sign-in isn't configured correctly. Please try again later.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth-not-ready":
      return "Sign-in isn't ready yet. Please try again in a moment.";
    default:
      return fallback || "Sign-in failed. Please try again.";
  }
}

// --- Firebase Auth: eagerly start init on the client ---
let firebaseAuth: Auth | null = null;
let authPromise: Promise<Auth | null> | null = null;

async function initAuth(): Promise<Auth | null> {
  if (authPromise) return authPromise;
  if (typeof window === "undefined") {
    authPromise = Promise.resolve(null);
    return authPromise;
  }

  authPromise = (async () => {
    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };

    if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.authDomain) {
      console.warn(
        "Firebase Auth config is incomplete. Ensure VITE_FIREBASE_* env vars are set.",
        firebaseConfig,
      );
      return null;
    }

    const [{ initializeApp, getApps, getApp }, { getAuth }] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
    ]);

    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    firebaseAuth = getAuth(app);
    return firebaseAuth;
  })();
  return authPromise;
}

initAuth();

// --- Cached Firebase Auth actions ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedSignOut: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedSignInWithPopup: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedSignInWithRedirect: any = null;

async function ensureActions() {
  if (cachedSignOut) return;
  const mod = await import("firebase/auth");
  cachedSignOut = mod.signOut;
  cachedSignInWithPopup = mod.signInWithPopup;
  cachedSignInWithRedirect = mod.signInWithRedirect;
}

// --- AuthProvider ---
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    initAuth()
      .then(async (auth) => {
        if (!auth) {
          setLoading(false);
          return;
        }

        await ensureActions();
        const mod = await import("firebase/auth");

        const handleAuthState = async (firebaseUser: User | null) => {
          setUser(firebaseUser);
          if (firebaseUser) {
            setSigningIn(false);
          }

          if (firebaseUser) {
            let token: string | null = null;
            try {
              token = await firebaseUser.getIdToken();
            } catch {
              // token unavailable — skip background seeding/prefetch below
            }
            if (token) {
              try {
                const { ensureUserProfile } = await import("./user-likes");
                await ensureUserProfile({
                  data: {
                    token,
                    uid: firebaseUser.uid,
                    email: firebaseUser.email,
                    displayName: firebaseUser.displayName,
                    photoURL: firebaseUser.photoURL,
                    creationTime: firebaseUser.metadata?.creationTime ?? null,
                  },
                });
              } catch {
                // non-critical — user doc will be created on first like if this fails
              }
              try {
                const { prefetchUserProfile } = await import("./user-profile");
                void prefetchUserProfile(
                  firebaseUser.uid,
                  token,
                  firebaseUser.metadata?.creationTime ?? null,
                );
              } catch {
                // non-critical — profile loads on the profile page if prefetch fails
              }
            }
          }
        };

        const unsubscribe = initializeAuthSession(
          auth,
          {
            onAuthStateChanged: (currentAuth, callback) =>
              mod.onAuthStateChanged(currentAuth, callback),
            getRedirectResult: (currentAuth) => mod.getRedirectResult(currentAuth),
          },
          handleAuthState,
          () => setLoading(false),
        );

        return unsubscribe;
      })
      .catch((err) => {
        console.error("Firebase Auth init error:", err);
        setLoading(false);
      });
  }, []);

  const signInWithGoogle = async (): Promise<SignInResult> => {
    if (signingIn) {
      return {
        ok: false,
        code: "auth/in-progress",
        message: "Sign-in is already in progress.",
      };
    }

    setSigningIn(true);
    try {
      await ensureActions();
      if (!firebaseAuth) {
        await initAuth();
      }
      if (!firebaseAuth) {
        setSigningIn(false);
        return {
          ok: false,
          code: "auth-not-ready",
          message: messageForAuthCode("auth-not-ready"),
        };
      }

      const { GoogleAuthProvider } = await import("firebase/auth");
      const provider = new GoogleAuthProvider();

      try {
        await cachedSignInWithPopup!(firebaseAuth, provider);
        setSigningIn(false);
        return { ok: true };
      } catch (err: unknown) {
        const firstErr = err as { code?: string; message?: string };
        let errorCode = firstErr?.code || "";

        if (errorCode === "auth/popup-blocked" && cachedSignInWithRedirect) {
          toast("Popup was blocked. Redirecting to Google sign-in...");
          try {
            await cachedSignInWithRedirect(firebaseAuth, provider);
            return {
              ok: false,
              code: "auth/popup-blocked",
              message: "Redirecting to Google sign-in…",
              redirecting: true,
            };
          } catch (redirectErr: unknown) {
            const re = redirectErr as { code?: string; message?: string };
            errorCode = re?.code || "";
            const message = messageForAuthCode(errorCode, re?.message);
            console.error("Google sign-in error:", redirectErr);
            setSigningIn(false);
            return { ok: false, code: errorCode || "auth/unknown", message };
          }
        }

        const message = messageForAuthCode(errorCode, firstErr?.message);
        if (
          errorCode !== "auth/popup-closed-by-user" &&
          errorCode !== "auth/cancelled-popup-request"
        ) {
          console.error("Google sign-in error:", err);
        }
        setSigningIn(false);
        return { ok: false, code: errorCode || "auth/unknown", message };
      }
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      setSigningIn(false);
      return {
        ok: false,
        code: e?.code || "auth/unknown",
        message: messageForAuthCode(e?.code || "", e?.message),
      };
    }
  };

  const signOut = async () => {
    await ensureActions();
    if (firebaseAuth && cachedSignOut) {
      await cachedSignOut(firebaseAuth);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signingIn, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
