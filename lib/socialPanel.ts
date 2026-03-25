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
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { GLYPHS } from "./constants";
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

export type SocialPartyInvite = {
  id: string;
  partyId: string;
  hostId: string;
  hostDisplayName: string;
  inviteeId: string;
  status: string;
};

export type PartyInviteDecision = "accepted" | "declined";

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

export function toPendingPartyInvite(
  id: string,
  data: Record<string, unknown>,
): SocialPartyInvite | null {
  if (typeof data.partyId !== "string" || typeof data.hostId !== "string") {
    return null;
  }

  return {
    id,
    partyId: data.partyId,
    hostId: data.hostId,
    hostDisplayName:
      typeof data.hostDisplayName === "string" && data.hostDisplayName.trim()
        ? data.hostDisplayName
        : "A player",
    inviteeId: typeof data.inviteeId === "string" ? data.inviteeId : "",
    status: typeof data.status === "string" ? data.status : "pending",
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

export async function respondToPartyInvite(params: {
  db: Firestore;
  inviteId: string;
  currentUserId: string;
  playerDisplayName: string;
  decision: PartyInviteDecision;
}) {
  const { db, inviteId, currentUserId, playerDisplayName, decision } = params;
  const inviteRef = doc(db, "partyInvites", inviteId);

  if (decision === "declined") {
    await updateDoc(inviteRef, {
      status: "declined",
      respondedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(
      doc(db, "users", currentUserId),
      {
        pendingPartyInviteId: null,
        pendingPartyInviteUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return;
  }

  await runTransaction(db, async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    if (!inviteSnap.exists()) {
      throw new Error("Invite not found.");
    }

    const inviteData = inviteSnap.data();
    if ((inviteData.status as string | undefined) !== "pending") {
      throw new Error("This invite is no longer pending.");
    }

    const inviteeId =
      (inviteData.inviteeId as string | undefined) ??
      (inviteData.toUserId as string | undefined);

    if (inviteeId !== currentUserId) {
      throw new Error("Only the invited user can accept this invite.");
    }

    const partyId = inviteData.partyId as string | undefined;
    if (!partyId) {
      throw new Error("Invite is missing party details.");
    }

    const partyRef = doc(db, "parties", partyId);
    const partyMemberRef = doc(db, "parties", partyId, "partyMembers", currentUserId);
    const userRef = doc(db, "users", currentUserId);

    const [partySnap, existingMemberSnap] = await Promise.all([
      transaction.get(partyRef),
      transaction.get(partyMemberRef),
    ]);

    if (!partySnap.exists()) {
      throw new Error("Party not found.");
    }

    const partyData = partySnap.data();
    const existingPlayerIds = Array.isArray(partyData.playerIds)
      ? partyData.playerIds.filter((id): id is string => typeof id === "string")
      : [];
    const existingPlayerNames = Array.isArray(partyData.playerNames)
      ? partyData.playerNames.filter((name): name is string => typeof name === "string")
      : [];
    const availableGlyphs = Array.isArray(partyData.availableGlyphs)
      ? partyData.availableGlyphs.filter((glyph): glyph is string => typeof glyph === "string")
      : [...GLYPHS];
    const assignedGlyphs = Array.isArray(partyData.assignedGlyphs)
      ? partyData.assignedGlyphs.filter((glyph): glyph is string => typeof glyph === "string")
      : [];

    const isExistingMember = existingMemberSnap.exists() || existingPlayerIds.includes(currentUserId);
    const nextGlyph = availableGlyphs[0] ?? null;
    const nextPlayerIds = isExistingMember ? existingPlayerIds : [...existingPlayerIds, currentUserId];
    const nextPlayerNames = isExistingMember
      ? existingPlayerNames
      : [...existingPlayerNames, playerDisplayName];

    transaction.update(inviteRef, {
      status: "accepted",
      respondedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (!existingMemberSnap.exists()) {
      transaction.set(partyMemberRef, {
        displayName: playerDisplayName,
        photoURL: null,
        joinedAt: serverTimestamp(),
        isHost: false,
      });
    }

    transaction.update(partyRef, {
      memberIds: nextPlayerIds,
      playerIds: nextPlayerIds,
      playerNames: nextPlayerNames,
      playerCount: nextPlayerIds.length,
      players: nextPlayerIds.length,
      assignedGlyphs: isExistingMember || !nextGlyph ? assignedGlyphs : [...assignedGlyphs, nextGlyph],
      availableGlyphs:
        isExistingMember || !nextGlyph
          ? availableGlyphs
          : availableGlyphs.filter((glyph) => glyph !== nextGlyph),
      updatedAt: serverTimestamp(),
    });

    transaction.set(
      userRef,
      {
        activePartyId: partyId,
        pendingPartyInviteId: null,
        pendingPartyInviteUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function acceptPartyInvite(params: {
  db: Firestore;
  inviteId: string;
  currentUserId: string;
  playerDisplayName: string;
}) {
  return respondToPartyInvite({ ...params, decision: "accepted" });
}

export async function declinePartyInvite(params: { db: Firestore; inviteId: string; currentUserId: string }) {
  return respondToPartyInvite({ ...params, playerDisplayName: "", decision: "declined" });
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
