"use client";

import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousAuth } from "../lib/auth";
import { GLYPHS } from "../lib/constants";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";
import type { SpikeItemCount } from "../lib/game/deck";

const storageKey = "misty:username";
const usernameUpdatedEvent = "misty:username-updated";

export default function CreateLobbyForm() {
  const [name, setName] = useState("");
  const [spikeItemCount, setSpikeItemCount] = useState<SpikeItemCount>("high");
  const [spikeRowClear, setSpikeRowClear] = useState(true);
  const [spikeEndGameBonuses, setSpikeEndGameBonuses] = useState(true);
  const [isPrivateLobby, setIsPrivateLobby] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isJoiningLobby, setIsJoiningLobby] = useState(false);
  const [savedDisplayName, setSavedDisplayName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { uid } = useAnonymousAuth();
  const router = useRouter();
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
  const spikeItemCountLabel = spikeItemCountOptions[spikeItemCountIndex]?.label ?? "High";
  const hasSavedDisplayName = Boolean(savedDisplayName?.trim());

  useEffect(() => {
    const syncSavedDisplayName = () => {
      const storedName = window.localStorage.getItem(storageKey)?.trim() ?? "";
      setSavedDisplayName(storedName || null);
    };

    syncSavedDisplayName();
    window.addEventListener("storage", syncSavedDisplayName);
    window.addEventListener(usernameUpdatedEvent, syncSavedDisplayName);

    return () => {
      window.removeEventListener("storage", syncSavedDisplayName);
      window.removeEventListener(usernameUpdatedEvent, syncSavedDisplayName);
    };
  }, []);

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
      const resolvedName = savedDisplayName;
      if (!resolvedName) {
        setError("Save your display name before creating a lobby.");
        return;
      }
      const hostGlyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? GLYPHS[0];
      const lobbyRef = await addDoc(collection(db, "lobbies"), {
        name: name.trim(),
        createdAt: serverTimestamp(),
        status: "open",
        players: 1,
        playerCount: 1,
        playerIds: [uid],
        playerNames: [resolvedName],
        hostId: uid,
        hostDisplayName: resolvedName,
        assignedGlyphs: [hostGlyph],
        availableGlyphs: GLYPHS.filter((glyph) => glyph !== hostGlyph),
        spikeMode: true,
        spikeItemCount,
        spikeRowClear,
        spikeEndGameBonuses,
        isPrivate: isPrivateLobby,
      });
      setIsJoiningLobby(true);
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 1000);
      });
      await setDoc(doc(db, "lobbies", lobbyRef.id, "players", uid), {
        displayName: resolvedName,
        joinedAt: serverTimestamp(),
        isReady: false,
        glyph: hostGlyph,
      });
      setName("");
      router.push(`/lobby/${lobbyRef.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
      setIsJoiningLobby(false);
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

      <span className="lobby-mode-tag" aria-label="Settings">
        Settings
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
          placeholder="Friday Night Misty"
        />
      </div>
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
      {isJoiningLobby ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="join-lobby-title">
          <div className="modal">
            <h2 className="leaderboard-title" id="join-lobby-title">Lobby ready</h2>
            <p className="leaderboard-sub">Joining your new lobby…</p>
          </div>
        </div>
      ) : null}
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
              <div className="modal__subsettings" role="group" aria-label="Game settings">
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
                  <label className="modal__subsettings-option">
                    <span>Enable end game bonuses</span>
                    <span className="toggle">
                      <input
                        className="toggle__input"
                        type="checkbox"
                        checked={spikeEndGameBonuses}
                        onChange={(event) => setSpikeEndGameBonuses(event.target.checked)}
                        aria-describedby="spike-end-game-bonuses-helper"
                      />
                      <span className="toggle__track" aria-hidden="true" />
                    </span>
                  </label>
                  <p className="modal__option-help" id="spike-end-game-bonuses-helper">
                    Award three end-game bonuses worth -5 points each, including Fastest player.
                  </p>
                </div>
            </div>
            <div className="modal__option">
              <label className="modal__subsettings-option">
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
                Private lobbies won&apos;t appear in the public lobby list.
              </p>
            </div>
            <div className="modal__actions">
              <button className="form-button-full-width" type="button" onClick={() => setIsSettingsOpen(false)}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
