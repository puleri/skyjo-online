"use client";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { FormEvent, useEffect, useState } from "react";
import {
  readStoredUsername,
  resolvePlayerDisplayName,
  useAnonymousAuth,
  usernameUpdatedEvent,
} from "../lib/auth";
import { GLYPHS } from "../lib/constants";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

export default function CreateLobbyForm() {
  const [inviteeUserId, setInviteeUserId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingParty, setIsCreatingParty] = useState(false);
  const [savedDisplayName, setSavedDisplayName] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { uid, displayName, profileDisplayName } = useAnonymousAuth();
  const firebaseReady = isFirebaseConfigured;
  const hasSavedDisplayName = Boolean(savedDisplayName?.trim());

  useEffect(() => {
    const syncSavedDisplayName = () => {
      const nextDisplayName =
        profileDisplayName?.trim() || displayName?.trim() || readStoredUsername();
      setSavedDisplayName(nextDisplayName || null);
    };

    syncSavedDisplayName();
    window.addEventListener("storage", syncSavedDisplayName);
    window.addEventListener(usernameUpdatedEvent, syncSavedDisplayName);

    return () => {
      window.removeEventListener("storage", syncSavedDisplayName);
      window.removeEventListener(usernameUpdatedEvent, syncSavedDisplayName);
    };
  }, [displayName, profileDisplayName]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedInviteeId = inviteeUserId.trim();

    if (!firebaseReady || !trimmedInviteeId) {
      return;
    }
    if (!hasSavedDisplayName) {
      setError("Save your display name before inviting players.");
      return;
    }
    if (!uid) {
      setError("Sign in to invite players.");
      return;
    }
    if (trimmedInviteeId === uid) {
      setError("You cannot invite yourself.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const resolvedName = resolvePlayerDisplayName({
        profileDisplayName,
        authDisplayName: displayName,
        storedDisplayName: readStoredUsername(),
      });
      const inviteeUserRef = doc(db, "users", trimmedInviteeId);
      const inviteeUserSnap = await getDoc(inviteeUserRef);
      if (!inviteeUserSnap.exists()) {
        throw new Error("That user ID was not found.");
      }

      setIsCreatingParty(true);

      const hostGlyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? GLYPHS[0];
      const partyRef = await addDoc(collection(db, "parties"), {
        name: `${resolvedName}'s party`,
        hostId: uid,
        memberIds: [uid],
        activeGameId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: "open",
        playerCount: 1,
        hostDisplayName: resolvedName,
        playerIds: [uid],
        playerNames: [resolvedName],
        players: 1,
        assignedGlyphs: [hostGlyph],
        availableGlyphs: GLYPHS.filter((glyph) => glyph !== hostGlyph),
        preGameConfig: null,
        isPrivate: true,
      });

      await setDoc(doc(db, "parties", partyRef.id, "partyMembers", uid), {
        displayName: resolvedName,
        photoURL: null,
        joinedAt: serverTimestamp(),
        isHost: true,
      });

      await setDoc(
        doc(db, "users", uid),
        { activePartyId: partyRef.id, updatedAt: serverTimestamp() },
        { merge: true },
      );

      const inviteRef = await addDoc(collection(db, "partyInvites"), {
        partyId: partyRef.id,
        hostId: uid,
        hostDisplayName: resolvedName,
        inviteeId: trimmedInviteeId,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await runTransaction(db, async (transaction) => {
        transaction.update(inviteeUserRef, {
          pendingPartyInviteId: inviteRef.id,
          pendingPartyInviteUpdatedAt: serverTimestamp(),
        });
      });

      await updateDoc(doc(db, "parties", partyRef.id), {
        latestInviteeId: trimmedInviteeId,
        updatedAt: serverTimestamp(),
      });

      setSuccessMessage(`Invite sent to ${trimmedInviteeId}.`);
      setInviteeUserId("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsCreatingParty(false);
      setIsSubmitting(false);
    }
  };

  if (!firebaseReady) {
    return (
      <div className="notice">
        <strong>Missing Firebase configuration.</strong>
        <p>
          Add values to <code>.env.local</code> (see <code>.env.local.example</code>)
          before inviting players.
        </p>
        <p>
          Missing keys:{" "}
          {missingFirebaseConfig.length
            ? missingFirebaseConfig.join(", ")
            : "Unknown (restart the dev server)."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="label-input-grid">
        <label className="form-card-font" htmlFor="invitee-user-id">
          Player User ID
        </label>
        <input
          id="invitee-user-id"
          value={inviteeUserId}
          className="form-card-font remaining-grid"
          onChange={(event) => setInviteeUserId(event.target.value)}
          placeholder="Paste the player user ID"
        />
      </div>
      <button
        className="form-button-full-width form-card-font mb-10"
        type="submit"
        disabled={isSubmitting || !inviteeUserId.trim() || !uid || !hasSavedDisplayName}
      >
        {isSubmitting ? "Inviting..." : "Invite player"}
      </button>
      {!hasSavedDisplayName ? (
        <p className="notice">Save your player name above before inviting players.</p>
      ) : null}
      {error ? <p className="notice">{error}</p> : null}
      {successMessage ? <p className="notice">{successMessage}</p> : null}
      {isCreatingParty ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="creating-party-title">
          <div className="modal">
            <h2 className="leaderboard-title" id="creating-party-title">Creating party</h2>
            <p className="leaderboard-sub">Preparing your invite…</p>
          </div>
        </div>
      ) : null}
    </form>
  );
}
