import {
  arrayUnion,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

export const FRIEND_INVITE_STATUSES = ["pending", "accepted", "declined"] as const;

export type FriendInviteStatus = (typeof FRIEND_INVITE_STATUSES)[number];

export type FriendInvite = {
  fromUserId: string;
  toUserId: string;
  status: FriendInviteStatus;
  createdAt: unknown;
  updatedAt: unknown;
  respondedAt?: unknown;
};

function buildFriendInviteId(fromUserId: string, toUserId: string) {
  return `${fromUserId}__${toUserId}`;
}

export async function sendFriendInvite(fromUserId: string, toUserId: string) {
  if (!fromUserId.trim() || !toUserId.trim()) {
    throw new Error("Both fromUserId and toUserId are required.");
  }

  if (fromUserId === toUserId) {
    throw new Error("You cannot send a friend invite to yourself.");
  }

  const inviteRef = doc(collection(db, "friendInvites"), buildFriendInviteId(fromUserId, toUserId));

  await runTransaction(db, async (transaction) => {
    const existingInviteSnapshot = await transaction.get(inviteRef);
    const existingInvite = existingInviteSnapshot.data() as Partial<FriendInvite> | undefined;

    if (existingInvite?.status === "pending") {
      return;
    }

    transaction.set(
      inviteRef,
      {
        fromUserId,
        toUserId,
        status: "pending",
        createdAt: existingInvite?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
        respondedAt: null,
      } satisfies FriendInvite,
      { merge: true },
    );
  });

  return inviteRef.id;
}

export async function acceptFriendInvite(inviteId: string, currentUserId: string) {
  const inviteRef = doc(db, "friendInvites", inviteId);

  await runTransaction(db, async (transaction) => {
    const inviteSnapshot = await transaction.get(inviteRef);
    if (!inviteSnapshot.exists()) {
      throw new Error("Friend invite not found.");
    }

    const inviteData = inviteSnapshot.data() as Partial<FriendInvite>;
    if (inviteData.status !== "pending") {
      throw new Error("This friend invite is no longer pending.");
    }

    if (inviteData.toUserId !== currentUserId) {
      throw new Error("Only the invited user can accept this friend invite.");
    }

    if (typeof inviteData.fromUserId !== "string" || typeof inviteData.toUserId !== "string") {
      throw new Error("Friend invite is missing required user IDs.");
    }

    const fromUserRef = doc(db, "users", inviteData.fromUserId);
    const toUserRef = doc(db, "users", inviteData.toUserId);

    const [fromUserSnapshot, toUserSnapshot] = await Promise.all([
      transaction.get(fromUserRef),
      transaction.get(toUserRef),
    ]);

    if (!fromUserSnapshot.exists() || !toUserSnapshot.exists()) {
      throw new Error("One or more users no longer exist.");
    }

    transaction.update(fromUserRef, {
      friends: arrayUnion(inviteData.toUserId),
      lastAcceptedFriendInviteId: inviteId,
      updatedAt: serverTimestamp(),
    });

    transaction.update(toUserRef, {
      friends: arrayUnion(inviteData.fromUserId),
      lastAcceptedFriendInviteId: inviteId,
      updatedAt: serverTimestamp(),
    });

    transaction.update(inviteRef, {
      status: "accepted",
      respondedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } satisfies Partial<FriendInvite>);
  });
}

export async function declineFriendInvite(inviteId: string, currentUserId: string) {
  const inviteRef = doc(db, "friendInvites", inviteId);

  await runTransaction(db, async (transaction) => {
    const inviteSnapshot = await transaction.get(inviteRef);
    if (!inviteSnapshot.exists()) {
      throw new Error("Friend invite not found.");
    }

    const inviteData = inviteSnapshot.data() as Partial<FriendInvite>;
    if (inviteData.toUserId !== currentUserId) {
      throw new Error("Only the invited user can decline this friend invite.");
    }

    transaction.update(inviteRef, {
      status: "declined",
      respondedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } satisfies Partial<FriendInvite>);
  });
}

export async function acceptFriendLinkInvite(fromUserId: string, toUserId: string) {
  if (!fromUserId.trim() || !toUserId.trim()) {
    throw new Error("Both fromUserId and toUserId are required.");
  }

  if (fromUserId === toUserId) {
    throw new Error("You cannot add yourself as a friend.");
  }

  const inviteId = await sendFriendInvite(fromUserId, toUserId);
  if (!inviteId) {
    throw new Error("Unable to create friend invite.");
  }

  await acceptFriendInvite(inviteId, toUserId);
}
