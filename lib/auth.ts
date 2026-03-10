"use client";

import {
  browserLocalPersistence,
  GoogleAuthProvider,
  getRedirectResult,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import { useCallback, useEffect, useState } from "react";
import { app, isFirebaseConfigured } from "./firebase";

type AuthMode = "anonymous" | "google" | null;

const authModeStorageKey = "misty:auth-mode";

type AuthState = {
  uid: string | null;
  email: string | null;
  displayName: string | null;
  isAnonymousUser: boolean;
  error: string | null;
  authMode: AuthMode;
  signInAsAnonymous: () => Promise<void>;
  signInWithGoogleSso: () => Promise<void>;
  goBackToSignInMethods: () => Promise<void>;
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

function clearAuthMode() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(authModeStorageKey);
}

export function useAnonymousAuth(): AuthState {
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isAnonymousUser, setIsAnonymousUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }

    const auth = getAuth(app);
    let isMounted = true;
    setAuthMode(loadStoredAuthMode());

    console.log("[auth] Current user on load:", auth.currentUser);

    void setPersistence(auth, browserLocalPersistence).catch((err) => {
      if (!isMounted) {
        return;
      }

      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!isMounted) {
        return;
      }

      console.log("[auth] Auth state changed:", user);

      const resolvedAuthMode = user
        ? user.isAnonymous
          ? "anonymous"
          : "google"
        : null;

      setUid(user?.uid ?? null);
      setEmail(user?.email ?? null);
      setDisplayName(user?.displayName ?? null);
      setIsAnonymousUser(user?.isAnonymous ?? false);
      setAuthMode(resolvedAuthMode);

      if (resolvedAuthMode) {
        saveAuthMode(resolvedAuthMode);
      } else {
        clearAuthMode();
      }

      if (user) {
        setError(null);
      }
    });

    void getRedirectResult(auth)
      .then((result) => {
        if (!isMounted || !result?.user) {
          return;
        }

        setUid(result.user.uid);
        setEmail(result.user.email ?? null);
        setDisplayName(result.user.displayName ?? null);
        setIsAnonymousUser(result.user.isAnonymous);
        setAuthMode(result.user.isAnonymous ? "anonymous" : "google");
        setError(null);
      })
      .catch((err) => {
        if (!isMounted) {
          return;
        }

        const message = err instanceof Error ? err.message : "Unknown error.";
        setError(message);
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

    console.log("[auth] Starting Google sign-in", {
      currentUser: auth.currentUser,
    });

    try {
      if (auth.currentUser?.isAnonymous) {
        await signOut(auth);
        console.log("[auth] Signed out anonymous user before Google sign-in");
      }

      await signInWithRedirect(auth, new GoogleAuthProvider());
      console.log("[auth] Triggered Google sign-in redirect");
      setError(null);
    } catch (err) {
      console.error("[auth] Google sign-in failed", err);
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  }, []);

  const goBackToSignInMethods = useCallback(async () => {
    setAuthMode(null);
    clearAuthMode();

    if (!isFirebaseConfigured) {
      return;
    }

    const auth = getAuth(app);
    if (auth.currentUser?.isAnonymous) {
      await signOut(auth);
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

  return {
    uid,
    email,
    displayName,
    isAnonymousUser,
    error,
    authMode,
    signInAsAnonymous,
    signInWithGoogleSso,
    goBackToSignInMethods,
  };
}
