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
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type FirestoreError,
} from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
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

async function ensureUserProfile(user: User) {
  const userRef = doc(db, "users", user.uid);
  const userSnapshot = await getDoc(userRef);
  const defaultProfile = defaultUserProfile(user);

  if (!userSnapshot.exists()) {
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
      ...(typeof existingProfile.displayName === "string" ? {} : { displayName: user.displayName }),
      ...(typeof existingProfile.email === "string" ? {} : { email: user.email }),
      ...(typeof existingProfile.photoURL === "string" ? {} : { photoURL: user.photoURL }),
      ...(Array.isArray(existingProfile.friends) ? {} : { friends: defaultProfile.friends }),
      ...(typeof existingProfile.activeGameId === "string" || existingProfile.activeGameId === null
        ? {}
        : { activeGameId: defaultProfile.activeGameId }),
      ...(existingProfile.presenceState === "online" ||
      existingProfile.presenceState === "in_game" ||
      existingProfile.presenceState === "offline"
        ? {}
        : { presenceState: defaultProfile.presenceState }),
      ...(existingProfile.lastSeenAt ? {} : { lastSeenAt: defaultProfile.lastSeenAt }),
      ...(Array.isArray(existingProfile.lastFiveGames)
        ? {}
        : { lastFiveGames: defaultProfile.lastFiveGames }),
      ...(existingProfile.settingsPreferences &&
      typeof existingProfile.settingsPreferences === "object"
        ? {}
        : { settingsPreferences: defaultProfile.settingsPreferences }),
      ...(typeof existingProfile.level === "number" ? {} : { level: defaultProfile.level }),
      ...(typeof existingProfile.experience === "number"
        ? {}
        : { experience: defaultProfile.experience }),
      ...(Array.isArray(existingProfile.unlockedSpells)
        ? {}
        : { unlockedSpells: defaultProfile.unlockedSpells }),
      ...(Array.isArray(existingProfile.rewardedGameIds)
        ? {}
        : { rewardedGameIds: defaultProfile.rewardedGameIds }),
      ...(existingProfile.lastXpGainAnimation &&
      typeof existingProfile.lastXpGainAnimation === "object"
        ? {}
        : { lastXpGainAnimation: defaultProfile.lastXpGainAnimation }),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error.";
}

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

    let isMounted = true;
    setLoading(true);

    void ensureUserProfile(user).catch((err) => {
      if (!isMounted) {
        return;
      }

      console.error("[useUserProfile] Failed to ensure user profile", err);
      setError(getErrorMessage(err));
      setLoading(false);
    });

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
  }, [currentUid]);

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
