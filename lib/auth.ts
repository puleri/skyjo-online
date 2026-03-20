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
  type User,
} from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import { app, db, isFirebaseConfigured } from "./firebase";
import { defaultUserProfile } from "./userProfile";

type AuthMode = "anonymous" | "google" | null;

const authModeStorageKey = "misty:auth-mode";

export const usernameStorageKey = "misty:username";
export const usernameUpdatedEvent = "misty:username-updated";

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
  isProfileLoading: boolean;
  isAnonymousUser: boolean;
  error: string | null;
  authMode: AuthMode;
  signInAsAnonymous: () => Promise<void>;
  signInWithGoogleSso: () => Promise<void>;
  goBackToSignInMethods: () => Promise<void>;
  saveProfileDisplayName: (nextDisplayName: string) => Promise<void>;
};

async function ensureUserProfile(user: User) {
  const userRef = doc(db, "users", user.uid);
  const userSnapshot = await getDoc(userRef);

  if (!userSnapshot.exists()) {
    const defaultProfile = defaultUserProfile(user);

    await setDoc(userRef, {
      ...defaultProfile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return;
  }

  const existingProfile = userSnapshot.data();
  await setDoc(
    userRef,
    {
      ...(existingProfile.displayName ? {} : { displayName: user.displayName }),
      email: user.email,
      photoURL: user.photoURL,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

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
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isAnonymousUser, setIsAnonymousUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }

    const auth = getAuth(app);
    let isMounted = true;
    let unsubscribeProfile: (() => void) | null = null;
    setAuthMode(loadStoredAuthMode());

    void setPersistence(auth, browserLocalPersistence).catch((err) => {
      if (!isMounted) {
        return;
      }

      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribeProfile?.();
      unsubscribeProfile = null;

      if (!isMounted) {
        return;
      }

      const resolvedAuthMode = user
        ? user.isAnonymous
          ? "anonymous"
          : "google"
        : null;

      setUid(user?.uid ?? null);
      setEmail(user?.email ?? null);
      setDisplayName(user?.displayName ?? null);
      setProfileDisplayName(null);
      setIsProfileLoading(false);
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
        setIsProfileLoading(true);
        void ensureUserProfile(user).catch((err) => {
          console.error("[auth] Failed to ensure user profile", err);
        });

        unsubscribeProfile = onSnapshot(
          doc(db, "users", user.uid),
          (snapshot) => {
            if (!isMounted) {
              return;
            }

            const nextDisplayName = snapshot.data()?.displayName;
            setProfileDisplayName(typeof nextDisplayName === "string" ? nextDisplayName : null);
            setIsProfileLoading(false);
          },
          (err) => {
            if (!isMounted) {
              return;
            }

            const message = err instanceof Error ? err.message : "Unknown error.";
            setError(message);
            setIsProfileLoading(false);
          }
        );
      }
    });

    return () => {
      isMounted = false;
      unsubscribeProfile?.();
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
