"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { FormEvent, useState } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

const storageKey = "skyjo:username";

export default function CreateLobbyForm() {
  const [name, setName] = useState("");
  const [spikeMode, setSpikeMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { uid } = useAnonymousAuth();
  const firebaseReady = isFirebaseConfigured;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firebaseReady || !name.trim()) {
      return;
    }
    if (!uid) {
      setError("Sign in to create a lobby.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const storedName = window.localStorage.getItem(storageKey);
      const resolvedName = storedName?.trim() || "A player";
      await addDoc(collection(db, "lobbies"), {
        name: name.trim(),
        createdAt: serverTimestamp(),
        status: "open",
        players: 1,
        hostId: uid,
        hostDisplayName: resolvedName,
        spikeMode,
      });
      setName("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
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
          placeholder="Friday Night Skyjo"
        />
      </div>
      <div className="label-input-grid">
        <span className="form-card-font">Spike mode</span>
        <div className="remaining-grid spike-toggle">
          <label className="ios-toggle">
            <input
              type="checkbox"
              checked={spikeMode}
              onChange={(event) => setSpikeMode(event.target.checked)}
              aria-describedby="spike-mode-helper"
              aria-label="Spike mode"
            />
            <span className="ios-toggle__track" aria-hidden="true" />
            <span className="ios-toggle__thumb" aria-hidden="true" />
          </label>
          <p className="form-helper-text" id="spike-mode-helper">
            Adds spicy twists to the rules and scoring for this lobby.
          </p>
        </div>
      </div>
      <button
        className="form-button-full-width form-card-font"
        type="submit"
        disabled={isSubmitting || !name.trim() || !uid}
      >
        {isSubmitting ? "Creating..." : "Create Lobby"}
      </button>
      {error ? <p className="notice">{error}</p> : null}
    </form>
  );
}
