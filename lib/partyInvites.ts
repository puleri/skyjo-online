import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { GLYPHS } from "./constants";

export type SocialPartyInvite = {
  id: string;
  partyId: string;
  hostId: string;
  hostDisplayName: string;
  inviteeId: string;
  status: string;
};

export type PartyInviteDecision = "accepted" | "declined";

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

export function subscribeToPendingPartyInvites(params: {
  db: Firestore;
  uid: string;
  onNext: (invites: SocialPartyInvite[]) => void;
  onError: (error: Error) => void;
}): Unsubscribe {
  const { db, uid, onNext, onError } = params;
  const partyInvitesQuery = query(
    collection(db, "partyInvites"),
    where("inviteeId", "==", uid),
    where("status", "==", "pending"),
  );

  return onSnapshot(
    partyInvitesQuery,
    (snapshot) => {
      onNext(
        snapshot.docs
          .map((inviteDoc) => toPendingPartyInvite(inviteDoc.id, inviteDoc.data() as Record<string, unknown>))
          .filter((invite): invite is SocialPartyInvite => Boolean(invite)),
      );
    },
    (snapshotError) => {
      onError(snapshotError);
    },
  );
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
      throw new Error("Only the invited user can respond to this invite.");
    }

    const userRef = doc(db, "users", currentUserId);

    if (decision === "declined") {
      transaction.update(inviteRef, {
        status: "declined",
        respondedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      transaction.set(
        userRef,
        {
          pendingPartyInviteId: null,
          pendingPartyInviteUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    const partyId = inviteData.partyId as string | undefined;
    if (!partyId) {
      throw new Error("Invite is missing party details.");
    }

    const partyRef = doc(db, "parties", partyId);
    const partyMemberRef = doc(db, "parties", partyId, "partyMembers", currentUserId);

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
