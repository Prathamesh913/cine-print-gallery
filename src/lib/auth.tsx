import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User, Auth } from "firebase/auth";
import { toast } from "sonner";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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

  useEffect(() => {
    initAuth()
      .then(async (auth) => {
        if (!auth) {
          setLoading(false);
          return;
        }

        await ensureActions();
        const mod = await import("firebase/auth");

        // Handle redirect result (e.g. fallback from popup-blocked)
        try {
          const result = await mod.getRedirectResult(auth);
          if (result?.user) {
            setUser(result.user);
          }
        } catch {
          // redirect result not available — expected on normal loads
        }

        const unsubscribe = mod.onAuthStateChanged(auth, async (firebaseUser) => {
          setUser(firebaseUser);
          setLoading(false);

          if (firebaseUser) {
            try {
              const { ensureUserProfile } = await import("./user-likes");
              await ensureUserProfile({
                data: {
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName,
                  photoURL: firebaseUser.photoURL,
                },
              });
            } catch {
              // non-critical — user doc will be created on first like if this fails
            }
          }
        });

        return unsubscribe;
      })
      .catch((err) => {
        console.error("Firebase Auth init error:", err);
        setLoading(false);
      });
  }, []);

  const signInWithGoogle = async () => {
    await ensureActions();
    if (!firebaseAuth) {
      toast.error("Firebase Auth is not ready yet. Please try again.");
      return;
    }
    try {
      const { GoogleAuthProvider } = await import("firebase/auth");
      const provider = new GoogleAuthProvider();
      // Try popup first; if blocked, fall back to redirect
      await cachedSignInWithPopup!(firebaseAuth, provider);
    } catch (err: any) {
      let errorCode = err?.code || "";

      if (errorCode === "auth/popup-blocked" && cachedSignInWithRedirect) {
        toast("Popup was blocked. Redirecting to Google sign-in...");
        try {
          const { GoogleAuthProvider } = await import("firebase/auth");
          const provider = new GoogleAuthProvider();
          await cachedSignInWithRedirect(firebaseAuth, provider);
          return;
        } catch (redirectErr: any) {
          err = redirectErr;
          errorCode = redirectErr?.code || "";
        }
      }

      if (errorCode === "auth/popup-closed-by-user") {
        toast("Sign-in cancelled.", {
          description: "You closed the sign-in window before completing authentication.",
        });
      } else if (errorCode === "auth/operation-not-allowed") {
        toast.error(
          "Google sign-in is not enabled. Please contact the site owner to enable it in the Firebase Console.",
        );
      } else if (errorCode === "auth/unauthorized-domain") {
        toast.error("This domain is not authorized for sign-in. Please contact the site owner.");
      } else if (errorCode === "auth/configuration-not-found") {
        toast.error(
          "Firebase auth configuration not found. Please check the Firebase Console settings.",
        );
      } else {
        toast.error(err?.message || "Sign in failed. Please try again.");
      }
      console.error("Google sign-in error:", err);
    }
  };

  const signOut = async () => {
    await ensureActions();
    if (firebaseAuth && cachedSignOut) {
      await cachedSignOut(firebaseAuth);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut }}>
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
