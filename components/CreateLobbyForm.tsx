"use client";

import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
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
  const [name, setName] = useState("");
  const [isPrivateLobby, setIsPrivateLobby] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingParty, setIsCreatingParty] = useState(false);
  const [createdPartyName, setCreatedPartyName] = useState<string | null>(null);
  const [savedDisplayName, setSavedDisplayName] = useState<string | null>(null);
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
    if (!firebaseReady || !name.trim()) {
      return;
    }
    if (!hasSavedDisplayName) {
      setError("Save your display name before creating a lobby.");
      return;
    }
    if (!uid) {
      setError("Sign in to create a lobby.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const resolvedName = resolvePlayerDisplayName({
        profileDisplayName,
        authDisplayName: displayName,
        storedDisplayName: readStoredUsername(),
      });
      const hostGlyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? GLYPHS[0];
      const partyRef = await addDoc(collection(db, "parties"), {
        name: name.trim(),
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
        isPrivate: isPrivateLobby,
      });
      setIsCreatingParty(true);
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 1000);
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
        { merge: true }
      );
      setIsCreatingParty(false);
      setCreatedPartyName(name.trim());
      setName("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
      setIsCreatingParty(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!firebaseReady) {
    return (
      <div className="notice">
        <strong>Missing Firebase configuration.</strong>
        <p>
          Add values to <code>.env.local</code> (see <code>.env.local.example</code>)
          before creating lobbies.
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
        <label className="form-card-font" htmlFor="lobby-name">
          Lobby Name
        </label>
        <input
          id="lobby-name"
          value={name}
          className="form-card-font remaining-grid"
          onChange={(event) => setName(event.target.value)}
          placeholder="Friday Night Misty"
        />
      </div>
      <label className="modal__subsettings-option mb-10" style={{ display: "flex" }}>
        <span>Private lobby</span>
        <span className="toggle">
          <input
            className="toggle__input"
            type="checkbox"
            checked={isPrivateLobby}
            onChange={(event) => setIsPrivateLobby(event.target.checked)}
            aria-describedby="private-lobby-helper"
          />
          <span className="toggle__track" aria-hidden="true" />
        </span>
      </label>
      <p className="modal__option-help" id="private-lobby-helper">
        Private lobbies are hidden from the public list and can only be joined via invite link.
      </p>
      <button
        className="form-button-full-width form-card-font mb-10"
        type="submit"
        disabled={isSubmitting || !name.trim() || !uid || !hasSavedDisplayName}
      >
        {isSubmitting ? "Creating..." : "Create Lobby"}
      </button>
      {!hasSavedDisplayName ? (
        <p className="notice">Save your player name above before creating a lobby.</p>
      ) : null}
      {error ? <p className="notice">{error}</p> : null}
      {createdPartyName ? (
        <p className="notice">Party “{createdPartyName}” created. Share your invite link to add players.</p>
      ) : null}
      {isCreatingParty ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="join-lobby-title">
          <div className="modal">
            <h2 className="leaderboard-title" id="join-lobby-title">Party ready</h2>
            <p className="leaderboard-sub">Saving your party…</p>
          </div>
        </div>
      ) : null}
    </form>
  );
}
