"use client";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured } from "../lib/firebase";
import { respondToPartyInvite, toPendingPartyInvite, type SocialPartyInvite } from "../lib/socialPanel";


export default function PartyInviteModal() {
  const { uid, displayName, profileDisplayName } = useAnonymousAuth();
  const [invite, setInvite] = useState<SocialPartyInvite | null>(null);
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
          .map((inviteDoc) => toPendingPartyInvite(inviteDoc.id, inviteDoc.data() as Record<string, unknown>))
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
      await respondToPartyInvite({
        db,
        inviteId: invite.id,
        currentUserId: uid,
        playerDisplayName,
        decision,
      });

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
