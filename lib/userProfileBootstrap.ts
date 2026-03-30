"use client";

import { type User } from "firebase/auth";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { defaultUserProfile } from "./userProfile";
import {
  profileIdentifierValueOrNull,
  syncUserIdentifierDocsInTransaction,
} from "./userIdentifiers";

type BootstrapStatus = "idle" | "loading" | "ready" | "error";

type BootstrapState = {
  status: BootstrapStatus;
  profileDisplayName: string | null;
  error: string | null;
  sessionId: number;
};

const bootstrapStateByUid = new Map<string, BootstrapState>();
const inFlightBootstrapByUid = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();

let activeSessionId = 0;

function emitChange() {
  listeners.forEach((listener) => listener());
}

const DEFAULT_BOOTSTRAP_STATE: BootstrapState = Object.freeze({
  status: "idle",
  profileDisplayName: null,
  error: null,
  sessionId: 0,
});

function setBootstrapState(uid: string, nextState: BootstrapState) {
  bootstrapStateByUid.set(uid, nextState);
  emitChange();
}

export function startUserProfileBootstrapSession(user: User | null) {
  activeSessionId += 1;

  if (!user || user.isAnonymous) {
    return;
  }

  const existingState = bootstrapStateByUid.get(user.uid);
  setBootstrapState(user.uid, {
    status: "loading",
    profileDisplayName: existingState?.profileDisplayName ?? null,
    error: null,
    sessionId: activeSessionId,
  });
}

export function subscribeUserProfileBootstrap(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUserProfileBootstrapState(uid: string | null): BootstrapState {
  if (!uid) {
    return DEFAULT_BOOTSTRAP_STATE;
  }

  return bootstrapStateByUid.get(uid) ?? DEFAULT_BOOTSTRAP_STATE;
}

export async function ensureUserProfile(user: User) {
  const existingState = bootstrapStateByUid.get(user.uid);
  if (
    existingState?.status === "ready" &&
    existingState.sessionId === activeSessionId
  ) {
    return existingState.profileDisplayName;
  }

  const inFlight = inFlightBootstrapByUid.get(user.uid);
  if (inFlight) {
    return inFlight;
  }

  const sessionIdForRequest = activeSessionId;
  const ensurePromise = (async () => {
    const userRef = doc(db, "users", user.uid);
    const defaultProfile = defaultUserProfile(user);
    let resolvedDisplayName: string | null = defaultProfile.displayName;

    await runTransaction(db, async (transaction) => {
      const userSnapshot = await transaction.get(userRef);

      if (!userSnapshot.exists()) {
        transaction.set(userRef, {
          ...defaultProfile,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        syncUserIdentifierDocsInTransaction({
          db,
          transaction,
          previous: { uid: user.uid, displayName: null, email: null },
          next: {
            uid: user.uid,
            displayName: defaultProfile.displayName,
            email: defaultProfile.email,
          },
        });
        resolvedDisplayName = defaultProfile.displayName;
        return;
      }

      const existingProfile = userSnapshot.data();
      resolvedDisplayName =
        typeof existingProfile.displayName === "string" && existingProfile.displayName.trim()
          ? existingProfile.displayName
          : user.displayName;

      const nextEmail =
        typeof existingProfile.email === "string" && existingProfile.email.trim()
          ? existingProfile.email
          : user.email;

      transaction.set(
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

      syncUserIdentifierDocsInTransaction({
        db,
        transaction,
        previous: {
          uid: user.uid,
          displayName: profileIdentifierValueOrNull(existingProfile.displayName),
          email: profileIdentifierValueOrNull(existingProfile.email),
        },
        next: {
          uid: user.uid,
          displayName: resolvedDisplayName,
          email: nextEmail,
        },
      });
    });

    setBootstrapState(user.uid, {
      status: "ready",
      profileDisplayName: resolvedDisplayName ?? null,
      error: null,
      sessionId: sessionIdForRequest,
    });

    return resolvedDisplayName ?? null;
  })();

  inFlightBootstrapByUid.set(user.uid, ensurePromise);

  try {
    return await ensurePromise;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    setBootstrapState(user.uid, {
      status: "error",
      profileDisplayName: existingState?.profileDisplayName ?? null,
      error: message,
      sessionId: sessionIdForRequest,
    });
    throw error;
  } finally {
    inFlightBootstrapByUid.delete(user.uid);
  }
}
