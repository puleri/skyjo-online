"use client";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { GLYPHS } from "../lib/constants";
import { db, isFirebaseConfigured } from "../lib/firebase";

type PartyInvite = {
  id: string;
  partyId: string;
  hostId: string;
  hostDisplayName: string;
  status: string;
};

function toPendingInvite(id: string, data: Record<string, unknown>): PartyInvite | null {
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
    status: typeof data.status === "string" ? data.status : "pending",
  };
}

export default function PartyInviteModal() {
  const { uid, displayName, profileDisplayName } = useAnonymousAuth();
  const [invite, setInvite] = useState<PartyInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firebaseReady = isFirebaseConfigured;

  useEffect(() => {
    if (!firebaseReady || !uid) {
      setInvite(null);
      return;
    }

    const invitesQuery = query(
      collection(db, "partyInvites"),
      where("inviteeId", "==", uid),
      where("status", "==", "pending"),
    );

    const unsubscribe = onSnapshot(
      invitesQuery,
      (snapshot) => {
        const pendingInvite = snapshot.docs
          .map((inviteDoc) => toPendingInvite(inviteDoc.id, inviteDoc.data() as Record<string, unknown>))
          .find((nextInvite) => Boolean(nextInvite));
        setInvite(pendingInvite ?? null);
        setError(null);
      },
      (snapshotError) => {
        setError(snapshotError.message);
      },
    );

    return () => unsubscribe();
  }, [firebaseReady, uid]);

  const playerDisplayName = useMemo(() => {
    const trimmedProfileName = profileDisplayName?.trim();
    if (trimmedProfileName) {
      return trimmedProfileName;
    }

    const trimmedDisplayName = displayName?.trim();
    return trimmedDisplayName || "Anonymous player";
  }, [displayName, profileDisplayName]);

  const handleInviteResponse = async (decision: "accepted" | "declined") => {
    if (!uid || !invite) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const inviteRef = doc(db, "partyInvites", invite.id);

      if (decision === "accepted") {
        const partyRef = doc(db, "parties", invite.partyId);
        const partyMemberRef = doc(db, "parties", invite.partyId, "partyMembers", uid);
        const userRef = doc(db, "users", uid);

        await runTransaction(db, async (transaction) => {
          const [inviteSnap, partySnap, existingMemberSnap] = await Promise.all([
            transaction.get(inviteRef),
            transaction.get(partyRef),
            transaction.get(partyMemberRef),
          ]);

          if (!inviteSnap.exists()) {
            throw new Error("Invite not found.");
          }
          if (!partySnap.exists()) {
            throw new Error("Party not found.");
          }

          const inviteData = inviteSnap.data();
          if ((inviteData.status as string | undefined) !== "pending") {
            throw new Error("This invite is no longer pending.");
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

          const isExistingMember = existingMemberSnap.exists() || existingPlayerIds.includes(uid);
          const nextGlyph = availableGlyphs[0] ?? null;
          const nextPlayerIds = isExistingMember ? existingPlayerIds : [...existingPlayerIds, uid];
          const nextPlayerNames = isExistingMember ? existingPlayerNames : [...existingPlayerNames, playerDisplayName];

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
              activePartyId: invite.partyId,
              pendingPartyInviteId: null,
              pendingPartyInviteUpdatedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        });
      } else {
        await updateDoc(inviteRef, {
          status: "declined",
          respondedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          await setDoc(
            userRef,
            {
              pendingPartyInviteId: null,
              pendingPartyInviteUpdatedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      }

      setInvite(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to process invite.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!invite) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="party-invite-title">
      <div className="modal">
        <h2 id="party-invite-title" className="leaderboard-title">Party invite</h2>
        <p className="leaderboard-sub">{invite.hostDisplayName} invited you to join their party.</p>
        {error ? <p className="notice">{error}</p> : null}
        <div className="modal__actions">
          <button
            className="form-button-full-width"
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              void handleInviteResponse("accepted");
            }}
          >
            {isSubmitting ? "Working..." : "Accept"}
          </button>
          <button
            className="form-button-full-width"
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              void handleInviteResponse("declined");
            }}
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
