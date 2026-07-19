import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import type { User, Auth } from "firebase/auth";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

let firebaseAuth: Auth | null = null;

async function getFirebaseAuth(): Promise<Auth | null> {
  if (firebaseAuth) return firebaseAuth;
  if (typeof window === "undefined") return null;

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
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actionsRef = useRef<any>(null);

  useEffect(() => {
    getFirebaseAuth().then(async (auth) => {
      if (!auth) {
        setLoading(false);
        return;
      }

      const mod = await import("firebase/auth");

      actionsRef.current = {
        signInWithPopup: mod.signInWithPopup,
        signOut: mod.signOut,
        onAuthStateChanged: mod.onAuthStateChanged,
      };

      const unsubscribe = mod.onAuthStateChanged(auth, (firebaseUser) => {
        setUser(firebaseUser);
        setLoading(false);
      });
      return unsubscribe;
    });
  }, []);

  const signInWithGoogle = async () => {
    const actions = actionsRef.current;
    if (!firebaseAuth || !actions) throw new Error("Firebase Auth not initialized");
    const { GoogleAuthProvider } = await import("firebase/auth");
    const provider = new GoogleAuthProvider();
    await actions.signInWithPopup(firebaseAuth, provider);
  };

  const signOut = async () => {
    const actions = actionsRef.current;
    if (firebaseAuth && actions) {
      await actions.signOut(firebaseAuth);
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
