"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { FormEvent, useState } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";
import type { SpikeItemCount } from "../lib/game/deck";

const storageKey = "skyjo:username";

export default function CreateLobbyForm() {
  const [name, setName] = useState("");
  const [spikeMode, setSpikeMode] = useState(false);
  const [spikeItemCount, setSpikeItemCount] = useState<SpikeItemCount>("low");
  const [spikeRowClear, setSpikeRowClear] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { uid } = useAnonymousAuth();
  const firebaseReady = isFirebaseConfigured;
  const spikeItemCountOptions: { value: SpikeItemCount; label: string }[] = [
    { value: "none", label: "None" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];
  const spikeItemCountIndex = Math.max(
    0,
    spikeItemCountOptions.findIndex((option) => option.value === spikeItemCount)
  );
  const spikeItemCountLabel = spikeItemCountOptions[spikeItemCountIndex]?.label ?? "Low";
  const modeTagLabel = spikeMode ? "spike" : "classic";

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
        playerCount: 1,
        playerIds: [uid],
        playerNames: [resolvedName],
        hostId: uid,
        hostDisplayName: resolvedName,
        spikeMode,
        ...(spikeMode ? { spikeItemCount, spikeRowClear } : {}),
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

      <span className="lobby-mode-tag" aria-label={`Mode: ${modeTagLabel}`}>
        {modeTagLabel}
      </span>
      <button
              type="button"
              className="game-settings-action-button"
              aria-label="Open slider settings"
              aria-haspopup="dialog"
              onClick={() => setIsSettingsOpen(true)}
            >
              <img className="game-settings-icon" src="/slider-icon.png" alt="slider icon" />
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
        className="form-button-full-width form-card-font mb-10"
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
            <h2 className="leaderboard-title" id="lobby-settings-title">Game settings</h2>
            <p className="leaderboard-sub">Customize how your lobby plays.</p>
            <div className="modal__option">
              <label className="modal__option-label modal__option-toggle">
                <span className="flex-full-center">
                  <img className="spike-icon" src="/spike-icon.png" alt="" aria-hidden="true" />
                  Spike mode
                </span>
                <span className="toggle">
                  <input
                    className="toggle__input"
                    type="checkbox"
                    checked={spikeMode}
                    onChange={(event) => {
                      const nextValue = event.target.checked;
                      setSpikeMode(nextValue);
                      if (!nextValue) {
                        setSpikeRowClear(false);
                      }
                    }}
                    aria-describedby="spike-mode-helper"
                  />
                  <span className="toggle__track" aria-hidden="true" />
                </span>
              </label>
              <p className="modal__option-help" id="spike-mode-helper">
                Special rules for a more challenging game.
              </p>
              {spikeMode ? (
                <div className="modal__subsettings" role="group" aria-label="Spike mode settings">
                  <div className="modal__slider">
                    <div className="modal__slider-header">
                      <span className="modal__subsettings-option">Item frequency</span>
                    </div>
                    <input
                      className="modal__slider-input"
                      type="range"
                      min="0"
                      max={spikeItemCountOptions.length - 1}
                      step="1"
                      value={spikeItemCountIndex}
                      onChange={(event) => {
                        const nextIndex = Number(event.target.value);
                        const nextValue =
                          spikeItemCountOptions[nextIndex]?.value ?? spikeItemCountOptions[0].value;
                        setSpikeItemCount(nextValue);
                      }}
                      aria-describedby="spike-item-count-helper"
                    />
                    <div className="modal__slider-labels" aria-hidden="true">
                      {spikeItemCountOptions.map((option) => (
                        <span key={option.value}>{option.label}</span>
                      ))}
                    </div>
                    <p className="modal__option-help" id="spike-item-count-helper">
                       ({spikeItemCountLabel} selected).
                    </p>
                  </div>
                  <label className="modal__subsettings-option">
                    <span>Enable matching row clears</span>
                    <span className="toggle">
                      <input
                        className="toggle__input"
                        type="checkbox"
                        checked={spikeRowClear}
                        onChange={(event) => setSpikeRowClear(event.target.checked)}
                        aria-describedby="spike-row-clear-helper"
                      />
                      <span className="toggle__track" aria-hidden="true" />
                    </span>
                  </label>
                  <p className="modal__option-help" id="spike-row-clear-helper">
                    Clear a row when all revealed cards match.
                  </p>
                </div>
              ) : null}
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
