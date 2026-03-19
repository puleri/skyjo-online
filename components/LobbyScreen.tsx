'use client';
import { collection, deleteDoc, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../lib/preferences";
import CreateLobbyForm from "./CreateLobbyForm";
import LobbyList from "./LobbyList";
import SnowfallLayer from "./SnowfallLayer";
import UsernameForm from "./UsernameForm";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

const heroBannerLight = "/images/misty-hero-banner.png";
const heroBannerDark = "/images/misty-hero-banner-darkmode.png";

type LeaderboardEntry = {
  id: string;
  displayName: string;
  score: number;
  gameId?: string | null;
  playerId?: string | null;
};

function isLeaderboardEntryActive(expiresAt: unknown) {
  return expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now();
}

export default function LobbyScreen() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { preferences, setPreference } = usePreferences();
  const {
    firstTimeTips: showFirstTimeTips,
    darkMode: isDarkMode,
    cardSounds: isCardSoundsEnabled,
    backgroundMusic: isBackgroundMusicEnabled,
    snow: isSnowEnabled,
    autoFollow: isAutoFollowEnabled,
  } = preferences;
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const heroBannerSrc = isDarkMode ? heroBannerDark : heroBannerLight;
  const firebaseReady = isFirebaseConfigured;
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const settingsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const leaderboardTriggerRef = useRef<HTMLButtonElement | null>(null);
  const leaderboardCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasSettingsOpen = useRef(false);
  const wasLeaderboardOpen = useRef(false);


  useEffect(() => {
    if (!firebaseReady) {
      setLeaderboardEntries([]);
      setLeaderboardError(null);
      return;
    }

    if (!isLeaderboardOpen) {
      return;
    }

    const leaderboardQuery = query(collection(db, "leaderboard"), orderBy("score", "asc"));
    const unsubscribe = onSnapshot(
      leaderboardQuery,
      (snapshot) => {
        const expiredEntries = snapshot.docs.filter(
          (entry) => !isLeaderboardEntryActive(entry.data().expiresAt)
        );
        if (expiredEntries.length) {
          void Promise.all(expiredEntries.map((entry) => deleteDoc(entry.ref))).catch(
            (err: Error) => setLeaderboardError(err.message)
          );
        }

        setLeaderboardEntries(
          snapshot.docs
            .filter((entry) => isLeaderboardEntryActive(entry.data().expiresAt))
            .slice(0, 10)
            .map((entry) => {
              const data = entry.data();
              return {
                id: entry.id,
                displayName: (data.displayName as string | undefined) ?? "Anonymous player",
                score: (data.score as number | undefined) ?? 0,
                gameId: (data.gameId as string | null | undefined) ?? null,
                playerId: (data.playerId as string | null | undefined) ?? null,
              };
            })
        );
        setLeaderboardError(null);
      },
      (err) => {
        setLeaderboardError(err.message);
      }
    );

    return () => unsubscribe();
  }, [firebaseReady, isLeaderboardOpen]);


  useEffect(() => {
    if (isSettingsOpen) {
      settingsCloseButtonRef.current?.focus();
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setIsSettingsOpen(false);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      wasSettingsOpen.current = true;
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }

    if (wasSettingsOpen.current) {
      settingsTriggerRef.current?.focus();
    }
    wasSettingsOpen.current = false;
  }, [isSettingsOpen]);

  useEffect(() => {
    if (isLeaderboardOpen) {
      leaderboardCloseButtonRef.current?.focus();
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setIsLeaderboardOpen(false);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      wasLeaderboardOpen.current = true;
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }

    if (wasLeaderboardOpen.current) {
      leaderboardTriggerRef.current?.focus();
    }
    wasLeaderboardOpen.current = false;
  }, [isLeaderboardOpen]);

  const podiumLabels = ["1st", "2nd", "3rd"];

  return (
    <main>
      {isSnowEnabled ? <SnowfallLayer height={"180%"} /> : null}
      <img className="welcome-div" src={heroBannerSrc} alt="Misty Hero Banner" />

      <div className="container">
        <div className="flex-space-between">
          <h2 className="sage-eyebrow-text">GETTING STARTED</h2>
          {/* when this button is clicked, it opens the rules image in another window */}
          <div className="menu-action-buttons">
            <button
              type="button"
              className="menu-action-button"
              aria-label="Open leaderboard"
              aria-haspopup="dialog"
              ref={leaderboardTriggerRef}
              onClick={() => setIsLeaderboardOpen(true)}
            >
              <img className="settings-icon" src="/leaderboard-icon.png" alt="Leaderboard icon" />
            </button>
            <button
              type="button"
              className="menu-action-button"
              aria-label="Open account and game settings"
              ref={settingsTriggerRef}
              onClick={() => setIsSettingsOpen(true)}
            >
              <img className="settings-icon" src="/profile.png" alt="Account settings icon" />
            </button>
            <Link
              href="/rules"
              className="menu-action-button"
              aria-label="Open game rules"
            >
              <img
                className="question-mark-icon"
                src="/question-mark-icon.png"
                alt="Misty Instructions Menu Icon"
              />
            </Link>
          </div>
        </div>
        {isSettingsOpen ? (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="main-menu-settings-title"
            onClick={() => setIsSettingsOpen(false)}
          >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <h2 id="main-menu-settings-title">Settings</h2>
              <p>Update your preferences.</p>
              <div className="modal__option">
                <label className="modal__option-label modal__option-toggle">
                  <span>First time tips</span>
                  <span className="toggle">
                    <input
                      className="toggle__input"
                      type="checkbox"
                      checked={showFirstTimeTips}
                      onChange={(event) => setPreference("firstTimeTips", event.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                  </span>
                </label>
                <p className="modal__option-help">
                  Show the quick hints about revealing, replacing, and swapping cards.
                </p>
              </div>
              <h3 className="modal__section-title">UI Preferences</h3>
              <div className="modal__option">
                <label className="modal__option-label modal__option-toggle">
                  <span>Dark mode</span>
                  <span className="toggle">
                    <input
                      className="toggle__input"
                      type="checkbox"
                      checked={isDarkMode}
                      onChange={(event) => setPreference("darkMode", event.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                  </span>
                </label>
                <p className="modal__option-help">Switch the interface to the dark theme.</p>
              </div>
              <div className="modal__option">
                <label className="modal__option-label modal__option-toggle">
                  <span>Let it snow</span>
                  <span className="toggle">
                    <input
                      className="toggle__input"
                      type="checkbox"
                      checked={isSnowEnabled}
                      onChange={(event) => setPreference("snow", event.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                  </span>
                </label>
                <p className="modal__option-help">
                  Sprinkle a light snowfall across the screen.
                </p>
              </div>
              <div className="modal__option">
                <label className="modal__option-label modal__option-toggle">
                  <span>Card sounds</span>
                  <span className="toggle">
                    <input
                      className="toggle__input"
                      type="checkbox"
                      checked={isCardSoundsEnabled}
                      onChange={(event) => setPreference("cardSounds", event.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                  </span>
                </label>
                <p className="modal__option-help">
                  Mute card draws, turn alerts, reveal sounds, and swap effects.
                </p>
              </div>
              <div className="modal__option">
                <label className="modal__option-label modal__option-toggle">
                  <span>Background music</span>
                  <span className="toggle">
                    <input
                      className="toggle__input"
                      type="checkbox"
                      checked={isBackgroundMusicEnabled}
                      onChange={(event) => setPreference("backgroundMusic", event.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                  </span>
                </label>
                <p className="modal__option-help">
                  Play theme music during round breaks and in the lobby.
                </p>
              </div>
              <div className="modal__option">
                <label className="modal__option-label modal__option-toggle">
                  <span>Auto-follow active player</span>
                  <span className="toggle">
                    <input
                      className="toggle__input"
                      type="checkbox"
                      checked={isAutoFollowEnabled}
                      onChange={(event) => setPreference("autoFollow", event.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                  </span>
                </label>
                <p className="modal__option-help">
                  Automatically follow the active player after scrolling settles.
                </p>
              </div>
              <div className="modal__actions">
                <button
                  className="form-button-full-width"
                  type="button"
                  ref={settingsCloseButtonRef}
                  onClick={() => setIsSettingsOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <section>
          <UsernameForm />
        </section>

        <section className="form-card">
          <CreateLobbyForm />
        </section>

        <div className="lobby-list-section">
          <div className="flex-space-between">
            <h2 className="charcoal-eyebrow-text">LOBBIES</h2>
          </div>
          <LobbyList />
        </div>

        {isLeaderboardOpen ? (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leaderboard-title"
            onClick={() => setIsLeaderboardOpen(false)}
          >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <h3 id="leaderboard-title">Leaderboard</h3>
              <p className="leaderboard-sub mb-0">Lowest 10 scores of the season.</p>
              <p className="leaderboard-sub text-xs">Entries expire after 90 days</p>

              {!firebaseReady ? (
                <p>
                  Provide your Firebase environment variables to load leaderboard results.
                  Missing keys:{" "}
                  {missingFirebaseConfig.length
                    ? missingFirebaseConfig.join(", ")
                    : "Unknown (restart the dev server)."}
                </p>
              ) : leaderboardError ? (
                <p>Firestore error: {leaderboardError}</p>
              ) : leaderboardEntries.length ? (
                <ol className="leaderboard-list">
                  {leaderboardEntries.map((entry, index) => {
                    const isPodium = index < podiumLabels.length;

                    return (
                      <li key={entry.id} className="leaderboard-list__item">
                        {isPodium ? (
                          <span
                            className={`leaderboard-list__badge leaderboard-list__badge--${index + 1}`}
                            aria-label={`${podiumLabels[index]} place`}
                          >
                            {podiumLabels[index]}
                          </span>
                        ) : (
                          <span className="leaderboard-list__rank">{index + 1}.</span>
                        )}
                        <span className="leaderboard-list__name">{entry.displayName}</span>
                        <span className="leaderboard-list__score">{entry.score}</span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="tiny-bold">No scores yet. Finish a game to claim a spot!</p>
              )}
              <div className="modal__actions">
                <button
                  className="form-button-full-width"
                  type="button"
                  ref={leaderboardCloseButtonRef}
                  onClick={() => setIsLeaderboardOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
