"use client";

import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  updateProfile as updateAuthProfile,
  type User,
} from "firebase/auth";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type FirestoreError,
} from "firebase/firestore";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { app, db, isFirebaseConfigured } from "./firebase";
import {
  cacheProfileDisplayName,
  usernameStorageKey,
  usernameUpdatedEvent,
} from "./auth";
import {
  defaultUserProfile,
  mergeUserProfile,
  type UserProfile,
  type UserProfileUpdate,
} from "./userProfile";
import {
  getUserProfileBootstrapState,
  subscribeUserProfileBootstrap,
} from "./userProfileBootstrap";

type UseUserProfileState = {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  authDisplayName: string | null;
  authEmail: string | null;
  isSignedIn: boolean;
  isAnonymousUser: boolean;
  updateProfile: (updates: UserProfileUpdate) => Promise<void>;
  signInWithGoogleSso: () => Promise<void>;
  signOutUser: () => Promise<void>;
};

function mapFirestoreProfile(user: User, value: unknown): UserProfile {
  const baseProfile = defaultUserProfile(user);
  if (!value || typeof value !== "object") {
    return baseProfile;
  }

  return mergeUserProfile(baseProfile, value as UserProfileUpdate);
}

export function useUserProfile(): UseUserProfileState {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [authDisplayName, setAuthDisplayName] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isAnonymousUser, setIsAnonymousUser] = useState(false);

  const bootstrapState = useSyncExternalStore(
    subscribeUserProfileBootstrap,
    () => getUserProfileBootstrapState(currentUid),
    () => getUserProfileBootstrapState(currentUid)
  );

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      setProfile(null);
      setError(null);
      setCurrentUid(null);
      setAuthDisplayName(null);
      setAuthEmail(null);
      setIsSignedIn(false);
      setIsAnonymousUser(false);
      return;
    }

    const auth = getAuth(app);
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!isMounted) {
        return;
      }

      setCurrentUid(user?.uid ?? null);
      setAuthDisplayName(user?.displayName ?? null);
      setAuthEmail(user?.email ?? null);
      setIsSignedIn(Boolean(user));
      setIsAnonymousUser(user?.isAnonymous ?? false);
      setProfile(null);
      setError(null);
      setLoading(Boolean(user && !user.isAnonymous));
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!currentUid) {
      setLoading(false);
      setProfile(null);
      return;
    }

    const auth = getAuth(app);
    const user = auth.currentUser;
    if (!user || user.uid !== currentUid || user.isAnonymous) {
      setLoading(false);
      setProfile(null);
      return;
    }

    if (bootstrapState.status === "error") {
      setError(bootstrapState.error ?? "Unknown error.");
      setLoading(false);
      return;
    }

    if (bootstrapState.status !== "ready") {
      setLoading(true);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const unsubscribe = onSnapshot(
      doc(db, "users", currentUid),
      (snapshot) => {
        if (!isMounted) {
          return;
        }

        setProfile(mapFirestoreProfile(user, snapshot.data()));
        setError(null);
        setLoading(false);
      },
      (snapshotError: FirestoreError) => {
        if (!isMounted) {
          return;
        }

        setError(snapshotError.message);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [bootstrapState.error, bootstrapState.status, currentUid]);

  const updateProfile = useCallback(async (updates: UserProfileUpdate) => {
    const auth = getAuth(app);
    const user = auth.currentUser;
    const trimmedDisplayName = updates.displayName?.trim();

    if (!user) {
      throw new Error("A signed-in user profile is required.");
    }

    if (user.isAnonymous) {
      if (updates.displayName !== undefined) {
        await updateAuthProfile(user, { displayName: trimmedDisplayName || null });
        setAuthDisplayName(trimmedDisplayName || null);

        if (typeof window !== "undefined") {
          if (trimmedDisplayName) {
            window.localStorage.setItem(usernameStorageKey, trimmedDisplayName);
          } else {
            window.localStorage.removeItem(usernameStorageKey);
          }

          window.dispatchEvent(new Event(usernameUpdatedEvent));
        }
      }
      return;
    }

    await setDoc(
      doc(db, "users", user.uid),
      {
        ...updates,
        ...(updates.displayName !== undefined ? { displayName: trimmedDisplayName || null } : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (updates.displayName !== undefined) {
      await updateAuthProfile(user, { displayName: trimmedDisplayName || null });

      if (typeof window !== "undefined") {
        if (trimmedDisplayName) {
          window.localStorage.setItem(usernameStorageKey, trimmedDisplayName);
        } else {
          window.localStorage.removeItem(usernameStorageKey);
        }

        cacheProfileDisplayName(user.uid, trimmedDisplayName || null);
        window.dispatchEvent(new Event(usernameUpdatedEvent));
      }
    }
  }, []);

  const signInWithGoogleSso = useCallback(async () => {
    const auth = getAuth(app);

    if (auth.currentUser?.isAnonymous) {
      await signOut(auth);
    }

    await signInWithPopup(auth, new GoogleAuthProvider());
  }, []);

  const signOutUser = useCallback(async () => {
    const auth = getAuth(app);
    await signOut(auth);
  }, []);

  return {
    profile,
    loading,
    error,
    authDisplayName,
    authEmail,
    isSignedIn,
    isAnonymousUser,
    updateProfile,
    signInWithGoogleSso,
    signOutUser,
  };
}
