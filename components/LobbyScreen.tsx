'use client';
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import CreateLobbyForm from "./CreateLobbyForm";
import LobbyList from "./LobbyList";
import SnowfallLayer from "./SnowfallLayer";
import UsernameForm from "./UsernameForm";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

const darkModeStorageKey = "skyjo-dark-mode";
const firstTimeTipsStorageKey = "skyjo-first-time-tips";
const cardSoundsStorageKey = "skyjo-card-sounds";
const backgroundMusicStorageKey = "skyjo-background-music";
const snowStorageKey = "skyjo-snow";
const heroBannerLight = "/images/skyjo-hero-banner.png";
const heroBannerDark = "/images/skyjo-hero-banner-darkmode.png";

type LeaderboardEntry = {
  id: string;
  displayName: string;
  score: number;
  gameId?: string | null;
  playerId?: string | null;
};

function getInitialDarkModePreference() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(darkModeStorageKey) === "true";
}

function getInitialSoundPreference(storageKey: string) {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(storageKey) === "true";
}

export default function LobbyScreen() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showFirstTimeTips, setShowFirstTimeTips] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(getInitialDarkModePreference);
  const [isCardSoundsEnabled, setIsCardSoundsEnabled] = useState(() =>
    getInitialSoundPreference(cardSoundsStorageKey)
  );
  const [isBackgroundMusicEnabled, setIsBackgroundMusicEnabled] = useState(() =>
    getInitialSoundPreference(backgroundMusicStorageKey)
  );
  const [isSnowEnabled, setIsSnowEnabled] = useState(() =>
    getInitialSoundPreference(snowStorageKey)
  );
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
    const storedTipsPreference = window.localStorage.getItem(firstTimeTipsStorageKey);
    if (storedTipsPreference !== null) {
      setShowFirstTimeTips(storedTipsPreference === "true");
    }
  }, []);

  useEffect(() => {
    if (!firebaseReady) {
      setLeaderboardEntries([]);
      setLeaderboardError(null);
      return;
    }

    if (!isLeaderboardOpen) {
      return;
    }

    const leaderboardQuery = query(
      collection(db, "leaderboard"),
      orderBy("score", "asc"),
      limit(10)
    );
    const unsubscribe = onSnapshot(
      leaderboardQuery,
      (snapshot) => {
        setLeaderboardEntries(
          snapshot.docs.map((entry) => {
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
    window.localStorage.setItem(firstTimeTipsStorageKey, String(showFirstTimeTips));
  }, [showFirstTimeTips]);

  useEffect(() => {
    window.localStorage.setItem(darkModeStorageKey, String(isDarkMode));
    if (isDarkMode) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [isDarkMode]);

  useEffect(() => {
    window.localStorage.setItem(cardSoundsStorageKey, String(isCardSoundsEnabled));
  }, [isCardSoundsEnabled]);

  useEffect(() => {
    window.localStorage.setItem(backgroundMusicStorageKey, String(isBackgroundMusicEnabled));
  }, [isBackgroundMusicEnabled]);

  useEffect(() => {
    window.localStorage.setItem(snowStorageKey, String(isSnowEnabled));
  }, [isSnowEnabled]);

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
      <img className="welcome-div" src={heroBannerSrc} alt="Skyjo Hero Banner" />

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
              aria-label="Open game settings"
              ref={settingsTriggerRef}
              onClick={() => setIsSettingsOpen(true)}
            >
              <img className="settings-icon" src="/settings-icon.png" alt="Settings icon" />
            </button>
            <button
              type="button"
              className="menu-action-button"
              aria-label="Open game rules"
              onClick={() => {
                window.open("/rules.png", "_blank");
              }}
            >
              <img
                className="question-mark-icon"
                src="/question-mark-icon.png"
                alt="Skyjo Instructions Menu Icon"
              />
            </button>
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
                      onChange={(event) => setShowFirstTimeTips(event.target.checked)}
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
                      onChange={(event) => setIsDarkMode(event.target.checked)}
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
                      onChange={(event) => setIsSnowEnabled(event.target.checked)}
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
                      onChange={(event) => setIsCardSoundsEnabled(event.target.checked)}
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
                      onChange={(event) => setIsBackgroundMusicEnabled(event.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                  </span>
                </label>
                <p className="modal__option-help">
                  Play theme music during round breaks and in the lobby.
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
              <p className="leaderboard-sub">Lowest 10 scores of all time.</p>
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
