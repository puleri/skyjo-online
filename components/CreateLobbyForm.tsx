"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { FormEvent, useState } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

const storageKey = "skyjo:username";

export default function CreateLobbyForm() {
  const [name, setName] = useState("");
  const [spikeMode, setSpikeMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
      <button
        className="form-button-full-width form-card-font"
        type="button"
        onClick={() => setIsSettingsOpen(true)}
      >
        Game settings
      </button>
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
      <button
        className="form-button-full-width form-card-font"
        type="submit"
        disabled={isSubmitting || !name.trim() || !uid}
      >
        {isSubmitting ? "Creating..." : "Create Lobby"}
      </button>
      {error ? <p className="notice">{error}</p> : null}
      {isSettingsOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lobby-settings-title"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2 id="lobby-settings-title">Game settings</h2>
            <p>Customize how your lobby plays.</p>
            <div className="modal__option">
              <label className="modal__option-label modal__option-toggle">
                <span>
                  <img className="spike-icon" src="/spike-icon.png" alt="" aria-hidden="true" />
                  Spike mode
                </span>
                <span className="toggle">
                  <input
                    className="toggle__input"
                    type="checkbox"
                    checked={spikeMode}
                    onChange={(event) => setSpikeMode(event.target.checked)}
                    aria-describedby="spike-mode-helper"
                  />
                  <span className="toggle__track" aria-hidden="true" />
                </span>
              </label>
              <p className="modal__option-help" id="spike-mode-helper">
                Add spike cards for an extra challenge.
              </p>
            </div>
            <div className="modal__actions">
              <button className="form-button-full-width" type="button" onClick={() => setIsSettingsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
