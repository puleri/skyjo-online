"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousAuth } from "../lib/auth";
import type { SpikeItemCount } from "../lib/game/deck";
import {
  isFirebaseConfigured,
  missingFirebaseConfig,
} from "../lib/firebase";
import LoadingSwipeOverlay from "./LoadingSwipeOverlay";
import SnowfallLayer from "./SnowfallLayer";
import {
  MIN_PARTY_SIZE_TO_START,
  isValidPreGameConfig,
  type GameType,
  type PreGameConfig,
  useParty,
} from "./LobbyProvider";

type LobbyDetailProps = {
  lobbyId: string;
};

const backgroundMusicStorageKey = "misty-background-music";
const darkModeStorageKey = "misty-dark-mode";
const snowStorageKey = "misty-snow";
const THEME_FADE_IN_SECONDS = 1.5;
const THEME_TARGET_VOLUME = 1;
const lobbyBgSnowLight = "/images/misty-lobby-bg-snow.png";
const lobbyBgSnowDark = "/images/misty-lobby-bg-snow-dark.png";
const themeLoopAudioUrl = "/sounds/theme/main-theme-loop.wav";
let themeLoopAudioDataPromise: Promise<ArrayBuffer> | null = null;

const loadThemeLoopAudioData = () => {
  if (!themeLoopAudioDataPromise) {
    themeLoopAudioDataPromise = fetch(themeLoopAudioUrl)
      .then((response) => response.arrayBuffer())
      .catch((error) => {
        themeLoopAudioDataPromise = null;
        throw error;
      });
  }
  return themeLoopAudioDataPromise;
};

export default function LobbyDetail({ lobbyId }: LobbyDetailProps) {
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [partyGameType, setPartyGameType] = useState<GameType>("spike");
  const [partySpikeItemCount, setPartySpikeItemCount] = useState<SpikeItemCount>("high");
  const [partySpikeRowClear, setPartySpikeRowClear] = useState(true);
  const [partySpikeEndGameBonuses, setPartySpikeEndGameBonuses] = useState(true);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(darkModeStorageKey) === "true";
  });
  const [isBackgroundMusicEnabled, setIsBackgroundMusicEnabled] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(backgroundMusicStorageKey) === "true";
  });
  const [isSnowEnabled, setIsSnowEnabled] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(snowStorageKey) === "true";
  });
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const { uid, error: authError } = useAnonymousAuth();
  const {
    partyId: activePartyId,
    party: activeParty,
    members: activePartyMembers,
    startGame: startPartyGame,
    setPreGameConfig,
    invite: inviteToParty,
    setActivePartyId,
    toggleReady,
  } = useParty();
  const firebaseReady = isFirebaseConfigured;
  const router = useRouter();

  useEffect(() => {
    if (!uid || !lobbyId) {
      return;
    }

    if (activePartyId === lobbyId) {
      return;
    }

    void setActivePartyId(lobbyId).catch(() => undefined);
  }, [activePartyId, lobbyId, setActivePartyId, uid]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!isBackgroundMusicEnabled) {
      return;
    }

    const audioContext = new AudioContext();
    const gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
    audioContextRef.current = audioContext;

    let isActive = true;

    const handleResume = () => {
      audioContext.resume().catch(() => undefined);
    };

    window.addEventListener("click", handleResume, { once: true });
    window.addEventListener("keydown", handleResume, { once: true });
    window.addEventListener("touchstart", handleResume, { once: true });

    loadThemeLoopAudioData()
      .then((buffer) => audioContext.decodeAudioData(buffer.slice(0)))
      .then((decodedBuffer) => {
        if (!isActive) {
          return;
        }
        const source = audioContext.createBufferSource();
        source.buffer = decodedBuffer;
        source.loop = true;
        source.connect(gainNode);
        const now = audioContext.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(THEME_TARGET_VOLUME, now + THEME_FADE_IN_SECONDS);
        source.start(0);
        audioSourceRef.current = source;
      })
      .catch(() => undefined);

    return () => {
      isActive = false;
      audioSourceRef.current?.stop();
      audioSourceRef.current?.disconnect();
      audioSourceRef.current = null;
      gainNode.disconnect();
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, [isBackgroundMusicEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(backgroundMusicStorageKey, String(isBackgroundMusicEnabled));
  }, [isBackgroundMusicEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === darkModeStorageKey) {
        setIsDarkMode(event.newValue === "true");
      }
      if (event.key === snowStorageKey) {
        setIsSnowEnabled(event.newValue === "true");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // useEffect(() => {
  //   const timer = window.setTimeout(() => {
  //     setShowLoadingOverlay(false);
  //   }, 1000);

  //   return () => window.clearTimeout(timer);
  // }, []);

  useEffect(() => {
    if (authError) {
      setError(authError);
    }
  }, [authError]);

  const displayedPlayers = useMemo(
    () =>
      activePartyMembers.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        isReady: member.isReady,
        glyph: "player-glyph-sun",
      })),
    [activePartyMembers],
  );

  useEffect(() => {
    if (!activeParty?.preGameConfig) {
      return;
    }
    setPartyGameType(activeParty.preGameConfig.gameType);
    setPartySpikeItemCount(activeParty.preGameConfig.spikeItemCount);
    setPartySpikeRowClear(activeParty.preGameConfig.spikeRowClear);
    setPartySpikeEndGameBonuses(activeParty.preGameConfig.spikeEndGameBonuses);
  }, [activeParty?.preGameConfig]);

  useEffect(() => {
    if (!activeParty?.activeGameId) {
      return;
    }

    router.push(`/game/${activeParty.activeGameId}`);
  }, [activeParty?.activeGameId, router]);

  const currentPlayer = useMemo(
    () => (uid ? displayedPlayers.find((player) => player.id === uid) ?? null : null),
    [displayedPlayers, uid]
  );
  const isHost = Boolean(uid && activeParty?.hostId && uid === activeParty.hostId);
  const hostPlayer = useMemo(
    () => (activeParty?.hostId ? displayedPlayers.find((player) => player.id === activeParty.hostId) ?? null : null),
    [activeParty?.hostId, displayedPlayers],
  );
  const allPlayersReady = displayedPlayers.length > 0 && displayedPlayers.every((player) => player.isReady);
  const hasMinPartySize = displayedPlayers.length >= MIN_PARTY_SIZE_TO_START;
  const hasValidPartyConfig = isValidPreGameConfig(activeParty?.preGameConfig);
  const canStartPartyGame = allPlayersReady && hasMinPartySize && hasValidPartyConfig;
  const invitePartyId = activePartyId ?? lobbyId;
  const inviteLink =
    typeof window === "undefined" ? "" : `${window.location.origin}/invite/${invitePartyId}`;
  const lobbySceneStyle = useMemo(() => {
    if (!isSnowEnabled) {
      return undefined;
    }
    const snowImage = isDarkMode ? lobbyBgSnowDark : lobbyBgSnowLight;
    return { ["--lobby-bg-image"]: `url("${snowImage}")` } as CSSProperties;
  }, [isDarkMode, isSnowEnabled]);

  const handleCopyInvite = async () => {
    if (!inviteLink) {
      setInviteStatus("Invite link unavailable.");
      return;
    }

    setInviteStatus(null);
    try {
      await inviteToParty();
      setInviteStatus("Invite link copied!");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to copy invite link.";
      setInviteStatus(message);
    }
  };

  const handleToggleReady = async () => {
    if (!uid) {
      setError("Sign in to update your readiness.");
      return;
    }

    if (!currentPlayer || activePartyId !== lobbyId) {
      setError("Join the lobby before updating readiness.");
      return;
    }

    setIsUpdating(true);
    setError(null);
    try {
      await toggleReady();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleStartGame = async () => {
    if (!uid) {
      setError("Sign in to start a game.");
      return;
    }
    if (!isHost) {
      setError("Only the host can start the game.");
      return;
    }
    if (!allPlayersReady) {
      setError("All players must be ready to start.");
      return;
    }
    if (!hasValidPartyConfig) {
      setError("Host must configure game settings before starting.");
      return;
    }
    if (!hasMinPartySize) {
      setError(`At least ${MIN_PARTY_SIZE_TO_START} players are required to start.`);
      return;
    }

    setIsStarting(true);
    setError(null);
    try {
      await startPartyGame();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsStarting(false);
    }
  };

  const handleSavePartyConfig = async () => {
    if (!isHost) {
      return;
    }
    const config: PreGameConfig = {
      gameType: partyGameType,
      spikeMode: partyGameType === "spike",
      spikeItemCount: partySpikeItemCount,
      spikeRowClear: partySpikeRowClear,
      spikeEndGameBonuses: partySpikeEndGameBonuses,
      targetScore: activeParty?.preGameConfig?.targetScore ?? 100,
    };
    if (!isValidPreGameConfig(config)) {
      setError("Invalid game settings.");
      return;
    }

    setError(null);
    setIsSavingConfig(true);
    try {
      await setPreGameConfig(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save settings.";
      setError(message);
    } finally {
      setIsSavingConfig(false);
    }
  };

  if (!lobbyId) {
    return (
      <>
        <LoadingSwipeOverlay isVisible={showLoadingOverlay} />
        <div className="notice">
          <strong>Loading lobby...</strong>
          <p>Waiting for a lobby ID before connecting to Firestore.</p>
        </div>
      </>
    );
  }

  if (!firebaseReady) {
    return (
      <>
        <LoadingSwipeOverlay isVisible={showLoadingOverlay} />
        <div className="notice">
          <strong>Firestore is not connected yet.</strong>
          <p>Provide your Firebase environment variables to load live lobbies.</p>
          <p>
            Missing keys:{" "}
            {missingFirebaseConfig.length
              ? missingFirebaseConfig.join(", ")
              : "Unknown (restart the dev server)."}
          </p>
        </div>
      </>
    );
  }

  return (
    <div className="lobby-detail">
      <LoadingSwipeOverlay isVisible={showLoadingOverlay} />
      {error ? <p className="notice">Firestore error: {error}</p> : null}

      {!displayedPlayers.length ? (
        <p>No players have joined this lobby yet.</p>
      ) : (
        <div className="lobby-scene-wrapper" style={lobbySceneStyle}>
          {isSnowEnabled ? <SnowfallLayer height={"100%"} zIndex={0} /> : null}
          <div className="lobby-scene" aria-label="Lobby players">
            {displayedPlayers.map((player) => (
              <div key={player.id} className="lobby-player">
                <img
                  className="lobby-player__glyph"
                  src={`/glyphs/${player.glyph}.svg`}
                  alt={`${player.displayName} glyph`}
                />
                <img
                  className="lobby-player__platform"
                  src="/glyphs/player-glyph-platform.svg"
                  alt=""
                  aria-hidden="true"
                />
                <span className="lobby-player__name">
                  {player.displayName}
                  {player.isReady ? (
                    <span className="lobby-player__ready" aria-label="Ready">
                      ✓
                    </span>
                  ) : null}
                </span>
              </div>
            ))}

          </div>
          <button
              type="button"
              className="lobby-detail__audio-toggle"
              onClick={() => setIsBackgroundMusicEnabled((current) => !current)}
              aria-pressed={isBackgroundMusicEnabled}
              aria-label={
                isBackgroundMusicEnabled ? "Mute background music" : "Unmute background music"
              }
            >
              {isBackgroundMusicEnabled ? (
                <svg viewBox="0 0 24 24" className="svg" aria-hidden="true" focusable="false">
                  <path d="M3 9v6h4l5 4V5L7 9H3z" />
                  <path d="M15.5 8.5a4 4 0 0 1 0 7" fill="none" stroke="currentColor" />
                  <path d="M18.5 6a7 7 0 0 1 0 12" fill="none" stroke="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="svg"aria-hidden="true" focusable="false">
                  <path d="M3 9v6h4l5 4V5L7 9H3z" />
                  <path d="M16 8l5 8" fill="none" stroke="currentColor" />
                  <path d="M21 8l-5 8" fill="none" stroke="currentColor" />
                </svg>
              )}
            </button>
          <div className="lobby-detail__actions">
            
            <button
              type="button"
              className={`form-button-full-width ${currentPlayer?.isReady ? "ready" : ""}`}
              onClick={handleToggleReady}
              disabled={!uid || !currentPlayer || isUpdating}
            >
              {isUpdating
                ? "Updating..."
                : currentPlayer?.isReady
                  ? `✓ Ready`
                  : "Ready"}
            </button>
            <button
              type="button"
              className="form-button-full-width"
              onClick={handleCopyInvite}
              disabled={!inviteLink}
            >
              Copy invite link
            </button>
            {inviteStatus ? <p className="lobby-detail__invite-status">{inviteStatus}</p> : null}
            {isHost ? (
              <>
                <div className="modal__subsettings" role="group" aria-label="Party game settings">
                  <label className="modal__subsettings-option">
                    <span>Game type</span>
                    <select
                      value={partyGameType}
                      onChange={(event) => setPartyGameType(event.target.value as GameType)}
                      disabled={isSavingConfig}
                    >
                      <option value="classic">Classic</option>
                      <option value="spike">Spike</option>
                    </select>
                  </label>
                  {partyGameType === "spike" ? (
                    <>
                      <label className="modal__subsettings-option">
                        <span>Item frequency</span>
                        <select
                          value={partySpikeItemCount}
                          onChange={(event) => setPartySpikeItemCount(event.target.value as SpikeItemCount)}
                          disabled={isSavingConfig}
                        >
                          <option value="none">None</option>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </label>
                      <label className="modal__subsettings-option">
                        <span>Enable matching row clears</span>
                        <span className="toggle">
                          <input
                            className="toggle__input"
                            type="checkbox"
                            checked={partySpikeRowClear}
                            onChange={(event) => setPartySpikeRowClear(event.target.checked)}
                            disabled={isSavingConfig}
                          />
                          <span className="toggle__track" aria-hidden="true" />
                        </span>
                      </label>
                      <label className="modal__subsettings-option">
                        <span>Enable end game bonuses</span>
                        <span className="toggle">
                          <input
                            className="toggle__input"
                            type="checkbox"
                            checked={partySpikeEndGameBonuses}
                            onChange={(event) => setPartySpikeEndGameBonuses(event.target.checked)}
                            disabled={isSavingConfig}
                          />
                          <span className="toggle__track" aria-hidden="true" />
                        </span>
                      </label>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="form-button-full-width"
                    onClick={handleSavePartyConfig}
                    disabled={isSavingConfig}
                  >
                    {isSavingConfig ? "Saving settings..." : "Save game settings"}
                  </button>
                </div>
                <button
                  type="button"
                  className="form-button-full-width"
                  onClick={handleStartGame}
                  disabled={!canStartPartyGame || isStarting}
                >
                  {isStarting ? "Starting..." : "Start game"}
                </button>
                {!hasValidPartyConfig ? (
                  <p className="lobby-detail__waiting">Save valid game settings to enable Start game.</p>
                ) : null}
                {!hasMinPartySize ? (
                  <p className="lobby-detail__waiting">
                    Need at least {MIN_PARTY_SIZE_TO_START} players before starting.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="lobby-detail__waiting">
                Once players are ready, <strong>{hostPlayer?.displayName ?? "the host"}</strong> can start the game.
              </p>
            )}
          </div>
        </div>

      )}
    </div>
  );
}
