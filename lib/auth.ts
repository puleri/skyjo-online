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
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
    });

    if (!auth.currentUser) {
      signInAnonymously(auth).catch((err) => {
        const message = err instanceof Error ? err.message : "Unknown error.";
        setError(message);
      });
    }

    return () => unsubscribe();
  }, []);

  return { uid, error };
}
