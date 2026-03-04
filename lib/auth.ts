"use client";

import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { useEffect, useState } from "react";
import { app, isFirebaseConfigured } from "./firebase";

type AuthState = {
  uid: string | null;
  error: string | null;
};

export function useAnonymousAuth(): AuthState {
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }

    const auth = getAuth(app);
    let isMounted = true;

    const tryAnonymousSignIn = async () => {
      if (auth.currentUser || !isMounted) {
        return;
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setError("Network is offline. Reconnecting will retry sign-in.");
        return;
      }

      try {
        await signInAnonymously(auth);
        if (isMounted) {
          setError(null);
        }
      } catch (err) {
        if (!isMounted) {
          return;
        }

        const message = err instanceof Error ? err.message : "Unknown error.";
        setError(message);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      if (user) {
        setError(null);
      }
    });

    void tryAnonymousSignIn();

    const handleOnline = () => {
      void tryAnonymousSignIn();
    };

    window.addEventListener("online", handleOnline);

    return () => {
      isMounted = false;
      window.removeEventListener("online", handleOnline);
      unsubscribe();
    };
  }, []);

  return { uid, error };
}
