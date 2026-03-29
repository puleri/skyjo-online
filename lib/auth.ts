"use client";

import {
  browserLocalPersistence,
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import { app, db, isFirebaseConfigured } from "./firebase";
import {
  ensureUserProfile,
  startUserProfileBootstrapSession,
} from "./userProfileBootstrap";

type AuthMode = "anonymous" | "google" | null;

const authModeStorageKey = "misty:auth-mode";
const profileDisplayNameStorageKeyPrefix = "misty:profile-display-name:";

export const usernameStorageKey = "misty:username";
export const usernameUpdatedEvent = "misty:username-updated";

function getProfileDisplayNameStorageKey(uid: string) {
  return `${profileDisplayNameStorageKeyPrefix}${uid}`;
}

function readCachedProfileDisplayName(uid: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const cachedName = window.localStorage.getItem(getProfileDisplayNameStorageKey(uid))?.trim();
  return cachedName || null;
}

export function cacheProfileDisplayName(uid: string, displayName: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = getProfileDisplayNameStorageKey(uid);
  const trimmedDisplayName = displayName?.trim();
  if (trimmedDisplayName) {
    window.localStorage.setItem(storageKey, trimmedDisplayName);
    return;
  }

  window.localStorage.removeItem(storageKey);
}

export function readStoredUsername() {
  if (typeof window === "undefined") {
    return null;
  }

  const storedName = window.localStorage.getItem(usernameStorageKey)?.trim();
  return storedName || null;
}

export function resolvePlayerDisplayName({
  profileDisplayName,
  authDisplayName,
  storedDisplayName,
}: {
  profileDisplayName?: string | null;
  authDisplayName?: string | null;
  storedDisplayName?: string | null;
}) {
  return (
    profileDisplayName?.trim() ||
    authDisplayName?.trim() ||
    storedDisplayName?.trim() ||
    "Anonymous player"
  );
}

type AuthState = {
  uid: string | null;
  email: string | null;
  displayName: string | null;
  profileDisplayName: string | null;
  isAuthStateReady: boolean;
  isProfileLoading: boolean;
  isAnonymousUser: boolean;
  error: string | null;
  authMode: AuthMode;
  signInAsAnonymous: () => Promise<void>;
  signInWithGoogleSso: () => Promise<void>;
  goBackToSignInMethods: () => Promise<void>;
  saveProfileDisplayName: (nextDisplayName: string) => Promise<void>;
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
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const [isAuthStateReady, setIsAuthStateReady] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isAnonymousUser, setIsAnonymousUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setIsAuthStateReady(true);
      return;
    }

    const auth = getAuth(app);
    let isMounted = true;
    let profileRequestId = 0;
    setAuthMode(loadStoredAuthMode());

    void setPersistence(auth, browserLocalPersistence).catch((err) => {
      if (!isMounted) {
        return;
      }

      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      startUserProfileBootstrapSession(user);
      profileRequestId += 1;
      const currentProfileRequestId = profileRequestId;
      if (!isMounted) {
        return;
      }

      const resolvedAuthMode = user
        ? user.isAnonymous
          ? "anonymous"
          : "google"
        : null;
      const cachedProfileDisplayName = user && !user.isAnonymous
        ? readCachedProfileDisplayName(user.uid)
        : null;

      setUid(user?.uid ?? null);
      setEmail(user?.email ?? null);
      setDisplayName(user?.displayName ?? null);
      setProfileDisplayName(cachedProfileDisplayName);
      setIsAuthStateReady(true);
      setIsProfileLoading(Boolean(user && !user.isAnonymous));
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

      if (user && !user.isAnonymous) {
        void ensureUserProfile(user)
          .then((resolvedProfileDisplayName) => {
            if (!isMounted || currentProfileRequestId !== profileRequestId) {
              return;
            }

            setProfileDisplayName(resolvedProfileDisplayName ?? null);
            cacheProfileDisplayName(user.uid, resolvedProfileDisplayName ?? null);
            setIsProfileLoading(false);
          })
          .catch((err) => {
            if (!isMounted || currentProfileRequestId !== profileRequestId) {
              return;
            }

            console.error("[auth] Failed to ensure user profile", err);
            const message = err instanceof Error ? err.message : "Unknown error.";
            setError(message);
            setIsProfileLoading(false);
          });
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
      if (auth.currentUser?.isAnonymous) {
        await signOut(auth);
      }

      await signInWithPopup(auth, new GoogleAuthProvider());
      setError(null);
    } catch (err) {
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

  const saveProfileDisplayName = useCallback(
    async (nextDisplayName: string) => {
      const trimmedDisplayName = nextDisplayName.trim();
      if (!uid || isAnonymousUser || !trimmedDisplayName) {
        return;
      }

      setProfileDisplayName(trimmedDisplayName);
      cacheProfileDisplayName(uid, trimmedDisplayName);

      await setDoc(
        doc(db, "users", uid),
        {
          displayName: trimmedDisplayName,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [isAnonymousUser, uid]
  );

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
    profileDisplayName,
    isAuthStateReady,
    isProfileLoading,
    isAnonymousUser,
    error,
    authMode,
    signInAsAnonymous,
    signInWithGoogleSso,
    goBackToSignInMethods,
    saveProfileDisplayName,
  };
}
