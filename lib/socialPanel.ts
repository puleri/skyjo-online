import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
} from "firebase/firestore";
import {
  acceptFriendInvite as acceptFriendInviteAction,
  declineFriendInvite as declineFriendInviteAction,
  sendFriendInvite as sendFriendInviteAction,
} from "./friendInvites";
import { chunkValues, subscribeToUsersByIdChunks } from "./userSubscriptions";
import { createUserIdentifierDocId, normalizeIdentifierValue } from "./userIdentifiers";

export type SocialUser = {
  uid: string;
  displayName: string;
  activeGameId: string | null;
};

export type SocialFriendInvite = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: string;
};

const IDENTIFIER_LOOKUP_CACHE_MAX_ENTRIES = 200;
const IDENTIFIER_LOOKUP_HIT_TTL_MS = 10 * 60 * 1000;
const IDENTIFIER_LOOKUP_MISS_TTL_MS = 45 * 1000;
const IDENTIFIER_NOT_FOUND = "not-found";

type IdentifierLookupValue = string | typeof IDENTIFIER_NOT_FOUND;
type IdentifierLookupCacheEntry = {
  value: IdentifierLookupValue;
  expiresAt: number;
};

const identifierLookupCache = new Map<string, IdentifierLookupCacheEntry>();
const identifierLookupInFlight = new Map<string, Promise<string>>();

function readIdentifierLookupCache(cacheKey: string): IdentifierLookupValue | null {
  const entry = identifierLookupCache.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (Date.now() >= entry.expiresAt) {
    identifierLookupCache.delete(cacheKey);
    return null;
  }

  // Refresh recency for LRU behavior.
  identifierLookupCache.delete(cacheKey);
  identifierLookupCache.set(cacheKey, entry);
  return entry.value;
}

function writeIdentifierLookupCache(cacheKey: string, value: IdentifierLookupValue) {
  const ttlMs = value === IDENTIFIER_NOT_FOUND ? IDENTIFIER_LOOKUP_MISS_TTL_MS : IDENTIFIER_LOOKUP_HIT_TTL_MS;
  identifierLookupCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  while (identifierLookupCache.size > IDENTIFIER_LOOKUP_CACHE_MAX_ENTRIES) {
    const oldestCacheKey = identifierLookupCache.keys().next().value;
    if (!oldestCacheKey) {
      return;
    }
    identifierLookupCache.delete(oldestCacheKey);
  }
}

export function normalizeSocialUser(uid: string, data: Record<string, unknown>): SocialUser {
  const fallbackName = uid ? `Player ${uid.slice(0, 6)}` : "Anonymous player";
  const displayName =
    typeof data.displayName === "string" && data.displayName.trim() ? data.displayName : fallbackName;

  return {
    uid,
    displayName,
    activeGameId: typeof data.activeGameId === "string" ? data.activeGameId : null,
  };
}

export async function resolveUserIdFromIdentifier(db: Firestore, identifier: string) {
  const trimmedIdentifier = identifier.trim();
  if (!trimmedIdentifier) {
    throw new Error("Provide a user ID or display name.");
  }

  const normalizedIdentifier = normalizeIdentifierValue(trimmedIdentifier);
  if (!normalizedIdentifier) {
    throw new Error("Provide a user ID or display name.");
  }

  const likelyKind = trimmedIdentifier.includes("@")
    ? "email"
    : /^[a-zA-Z0-9]{20,}$/.test(trimmedIdentifier)
      ? "uid"
      : "name";
  const lookupDocId = createUserIdentifierDocId(likelyKind, normalizedIdentifier);
  const cacheKey = lookupDocId;
  const cachedLookupResult = readIdentifierLookupCache(cacheKey);
  if (cachedLookupResult) {
    if (cachedLookupResult === IDENTIFIER_NOT_FOUND) {
      throw new Error("No matching user was found for that identifier.");
    }
    return cachedLookupResult;
  }

  const inFlightLookup = identifierLookupInFlight.get(cacheKey);
  if (inFlightLookup) {
    return inFlightLookup;
  }

  const lookupPromise = (async () => {
    const identifierRef = doc(db, "userIdentifiers", lookupDocId);
    const identifierSnapshot = await getDoc(identifierRef);
    if (identifierSnapshot.exists()) {
      const lookupData = identifierSnapshot.data();
      if (typeof lookupData.uid === "string" && lookupData.uid.trim()) {
        writeIdentifierLookupCache(cacheKey, lookupData.uid);
        return lookupData.uid;
      }
    }

    const byUidRef = doc(db, "users", trimmedIdentifier);
    const byUidSnap = await getDoc(byUidRef);
    if (byUidSnap.exists()) {
      writeIdentifierLookupCache(cacheKey, byUidSnap.id);
      return byUidSnap.id;
    }

    const [byDisplayNameSnap, byEmailSnap] = await Promise.all([
      getDocs(query(collection(db, "users"), where("displayName", "==", trimmedIdentifier), limit(1))),
      getDocs(query(collection(db, "users"), where("email", "==", trimmedIdentifier), limit(1))),
    ]);

    const byDisplayNameDoc = byDisplayNameSnap.docs[0];
    if (byDisplayNameDoc) {
      writeIdentifierLookupCache(cacheKey, byDisplayNameDoc.id);
      return byDisplayNameDoc.id;
    }

    const byEmailDoc = byEmailSnap.docs[0];
    if (byEmailDoc) {
      writeIdentifierLookupCache(cacheKey, byEmailDoc.id);
      return byEmailDoc.id;
    }

    writeIdentifierLookupCache(cacheKey, IDENTIFIER_NOT_FOUND);
    throw new Error("No matching user was found for that identifier.");
  })();

  identifierLookupInFlight.set(cacheKey, lookupPromise);
  try {
    return await lookupPromise;
  } finally {
    identifierLookupInFlight.delete(cacheKey);
  }
}

export async function sendFriendInviteByIdentifier(
  db: Firestore,
  fromUserId: string,
  targetIdentifier: string,
) {
  const targetUserId = await resolveUserIdFromIdentifier(db, targetIdentifier);
  return sendFriendInviteAction(fromUserId, targetUserId);
}

export async function acceptFriendInvite(inviteId: string, currentUserId: string) {
  return acceptFriendInviteAction(inviteId, currentUserId);
}

export async function declineFriendInvite(inviteId: string, currentUserId: string) {
  return declineFriendInviteAction(inviteId, currentUserId);
}

export async function inviteFriendToCurrentLobby(params: {
  db: Firestore;
  hostUid: string;
  hostDisplayName: string;
  friendUid: string;
  partyId: string;
}) {
  const { db, hostUid, hostDisplayName, friendUid, partyId } = params;

  if (!friendUid.trim()) {
    throw new Error("A friend user ID is required.");
  }

  if (!partyId.trim()) {
    throw new Error("A party ID is required.");
  }

  if (hostUid === friendUid) {
    throw new Error("You cannot invite yourself.");
  }

  const inviteRef = doc(collection(db, "partyInvites"));

  await runTransaction(db, async (transaction) => {
    transaction.set(inviteRef, {
      partyId,
      hostId: hostUid,
      fromUserId: hostUid,
      hostDisplayName,
      inviteeId: friendUid,
      toUserId: friendUid,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(
      doc(db, "users", friendUid),
      {
        pendingPartyInviteId: inviteRef.id,
        pendingPartyInviteUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });

  return inviteRef.id;
}

export function subscribeToFriendProfiles(params: {
  db: Firestore;
  friendUids: string[];
  onNext: (profiles: SocialUser[]) => void;
  onError: (error: Error) => void;
}) {
  const { db, friendUids, onNext, onError } = params;

  if (!friendUids.length) {
    onNext([]);
    return () => {};
  }

  const friendMap = new Map<string, SocialUser>();

  return subscribeToUsersByIdChunks({
    db,
    userIds: friendUids,
    onChunkSnapshot: (docs) => {
      docs.forEach((friendDoc) => {
        friendMap.set(friendDoc.id, normalizeSocialUser(friendDoc.id, friendDoc.data() as Record<string, unknown>));
      });

      onNext(
        friendUids
          .map((uid) => friendMap.get(uid))
          .filter((profile): profile is SocialUser => Boolean(profile)),
      );
    },
    onError,
  });
}

export async function loadFriendProfilesSnapshot(params: {
  db: Firestore;
  friendUids: string[];
}) {
  const { db, friendUids } = params;

  if (!friendUids.length) {
    return [] as SocialUser[];
  }

  const friendMap = new Map<string, SocialUser>();

  await Promise.all(
    chunkValues(friendUids, 10).map(async (uidChunk) => {
      const usersQuery = query(collection(db, "users"), where(documentId(), "in", uidChunk));
      const snapshot = await getDocs(usersQuery);
      snapshot.docs.forEach((friendDoc) => {
        friendMap.set(friendDoc.id, normalizeSocialUser(friendDoc.id, friendDoc.data() as Record<string, unknown>));
      });
    }),
  );

  return friendUids
    .map((uid) => friendMap.get(uid))
    .filter((profile): profile is SocialUser => Boolean(profile));
}

export function subscribeToHotFriendProfiles(params: {
  db: Firestore;
  friendUids: string[];
  onNext: (profiles: SocialUser[]) => void;
  onError: (error: Error) => void;
}) {
  return subscribeToFriendProfiles(params);
}
