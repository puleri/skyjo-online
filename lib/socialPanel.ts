import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import {
  acceptFriendInvite as acceptFriendInviteAction,
  declineFriendInvite as declineFriendInviteAction,
  sendFriendInvite as sendFriendInviteAction,
} from "./friendInvites";

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

function chunkValues(values: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function resolveUserIdFromIdentifier(db: Firestore, identifier: string) {
  const trimmedIdentifier = identifier.trim();
  if (!trimmedIdentifier) {
    throw new Error("Provide a user ID or display name.");
  }

  const byUidRef = doc(db, "users", trimmedIdentifier);
  const byUidSnap = await getDoc(byUidRef);
  if (byUidSnap.exists()) {
    return byUidSnap.id;
  }

  const [byDisplayNameSnap, byEmailSnap] = await Promise.all([
    getDocs(query(collection(db, "users"), where("displayName", "==", trimmedIdentifier), limit(1))),
    getDocs(query(collection(db, "users"), where("email", "==", trimmedIdentifier), limit(1))),
  ]);

  const byDisplayNameDoc = byDisplayNameSnap.docs[0];
  if (byDisplayNameDoc) {
    return byDisplayNameDoc.id;
  }

  const byEmailDoc = byEmailSnap.docs[0];
  if (byEmailDoc) {
    return byEmailDoc.id;
  }

  throw new Error("No matching user was found for that identifier.");
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
  const unsubscribers: Unsubscribe[] = [];

  chunkValues(friendUids, 10).forEach((uidChunk) => {
    const usersQuery = query(collection(db, "users"), where(documentId(), "in", uidChunk));

    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        snapshot.docs.forEach((friendDoc) => {
          friendMap.set(friendDoc.id, normalizeSocialUser(friendDoc.id, friendDoc.data() as Record<string, unknown>));
        });

        onNext(
          friendUids
            .map((uid) => friendMap.get(uid))
            .filter((profile): profile is SocialUser => Boolean(profile)),
        );
      },
      (error) => {
        onError(error);
      },
    );

    unsubscribers.push(unsubscribe);
  });

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
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
