"use client";

import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithRedirect,
} from "firebase/auth";
import { useCallback, useEffect, useState } from "react";
import { app, isFirebaseConfigured } from "./firebase";

type AuthMode = "anonymous" | "google" | null;

const authModeStorageKey = "skyjo:auth-mode";

type AuthState = {
  uid: string | null;
  error: string | null;
  authMode: AuthMode;
  signInAsAnonymous: () => Promise<void>;
  signInWithGoogleSso: () => Promise<void>;
};

function loadStoredAuthMode(): AuthMode {
  if (typeof window === "undefined") {
    return null;
  }

  const storedAuthMode = window.localStorage.getItem(authModeStorageKey);
  if (storedAuthMode === "anonymous" || storedAuthMode === "google") {
    return storedAuthMode;
  }

  return null;
}

function saveAuthMode(authMode: Exclude<AuthMode, null>) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(authModeStorageKey, authMode);
}

export function useAnonymousAuth(): AuthState {
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }

    const auth = getAuth(app);
    let isMounted = true;
    setAuthMode(loadStoredAuthMode());

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!isMounted) {
        return;
      }

      setUid(user?.uid ?? null);
      if (user) {
        setError(null);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const signInAsAnonymous = useCallback(async () => {
    if (!isFirebaseConfigured) {
      return;
    }

    const auth = getAuth(app);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("Network is offline. Reconnecting will retry sign-in.");
      return;
    }

    setAuthMode("anonymous");
    saveAuthMode("anonymous");

    if (auth.currentUser) {
      return;
    }

    try {
      await signInAnonymously(auth);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  }, []);

  const signInWithGoogleSso = useCallback(async () => {
    if (!isFirebaseConfigured) {
      return;
    }

    const auth = getAuth(app);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("Network is offline. Reconnecting will retry sign-in.");
      return;
    }

    setAuthMode("google");
    saveAuthMode("google");

    try {
      await signInWithRedirect(auth, new GoogleAuthProvider());
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  }, []);

  useEffect(() => {
    if (authMode !== "anonymous") {
      return;
    }

    const auth = getAuth(app);
    if (auth.currentUser) {
      return;
    }

    void signInAsAnonymous();
  }, [authMode, signInAsAnonymous]);

  return { uid, error, authMode, signInAsAnonymous, signInWithGoogleSso };
}
