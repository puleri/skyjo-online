"use client";
import {
  collection,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import Link from "next/link";
import {
  CSSProperties,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePreferences } from "../lib/preferences";
import CreateLobbyForm from "./CreateLobbyForm";
import LobbyList from "./LobbyList";
import SnowfallLayer from "./SnowfallLayer";
import UsernameForm from "./UsernameForm";
import {
  db,
  isFirebaseConfigured,
  missingFirebaseConfig,
} from "../lib/firebase";
import { useUserProfile } from "../lib/useUserProfile";
import {
  buildXpAnimationSegments,
  getStoredLevelProgress,
  getStoredLifetimeExperience,
  isNextLevelMultipleOfFive,
  type StoredLevelProgress,
  type XpAnimationSegment,
} from "../lib/progression";
import { formatPlacementLabel } from "../lib/userProfile";

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
    profile,
    loading: isProfileLoading,
    error: profileError,
    authDisplayName,
    authEmail,
    isSignedIn,
    isAnonymousUser,
    updateProfile,
  } = useUserProfile();
  const {
    firstTimeTips: showFirstTimeTips,
    darkMode: isDarkMode,
    cardSounds: isCardSoundsEnabled,
    backgroundMusic: isBackgroundMusicEnabled,
    snow: isSnowEnabled,
    autoFollow: isAutoFollowEnabled,
  } = preferences;
  const [isProfileOpen, setIsProfileOpen] = useState(true);
  const [isUiPreferencesOpen, setIsUiPreferencesOpen] = useState(false);
  const [isAccessibilityOpen, setIsAccessibilityOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileSaveMessage, setProfileSaveMessage] = useState<string | null>(
    null,
  );
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<
    LeaderboardEntry[]
  >([]);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [playbackSegmentIndex, setPlaybackSegmentIndex] = useState(0);
  const [displayedFillPercent, setDisplayedFillPercent] = useState(0);
  const [displayedLeftLevel, setDisplayedLeftLevel] = useState(1);
  const [displayedRightLevel, setDisplayedRightLevel] = useState(2);
  const [hasCompletedPlayback, setHasCompletedPlayback] = useState(false);
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

    const leaderboardQuery = query(
      collection(db, "leaderboard"),
      orderBy("score", "asc"),
    );
    const unsubscribe = onSnapshot(
      leaderboardQuery,
      (snapshot) => {
        const expiredEntries = snapshot.docs.filter(
          (entry) => !isLeaderboardEntryActive(entry.data().expiresAt),
        );
        if (expiredEntries.length) {
          void Promise.all(
            expiredEntries.map((entry) => deleteDoc(entry.ref)),
          ).catch((err: Error) => setLeaderboardError(err.message));
        }

        setLeaderboardEntries(
          snapshot.docs
            .filter((entry) => isLeaderboardEntryActive(entry.data().expiresAt))
            .slice(0, 10)
            .map((entry) => {
              const data = entry.data();
              return {
                id: entry.id,
                displayName:
                  (data.displayName as string | undefined) ??
                  "Anonymous player",
                score: (data.score as number | undefined) ?? 0,
                gameId: (data.gameId as string | null | undefined) ?? null,
                playerId: (data.playerId as string | null | undefined) ?? null,
              };
            }),
        );
        setLeaderboardError(null);
      },
      (err) => {
        setLeaderboardError(err.message);
      },
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

  useEffect(() => {
    const nextProfileName =
      profile?.displayName?.trim() || authDisplayName?.trim() || "";
    setProfileName(nextProfileName);
  }, [authDisplayName, profile?.displayName]);

  useEffect(() => {
    setProfileSaveMessage(null);
  }, [profileName]);

  const resolvedProfileName =
    profile?.displayName?.trim() ||
    authDisplayName?.trim() ||
    "Anonymous player";
  const recentPlacements = profile?.lastFiveGames ?? [];
  const recentPlacementSummary = useMemo(
    () =>
      recentPlacements
        .map((placement) => formatPlacementLabel(placement))
        .join(", "),
    [recentPlacements],
  );
  const canEditProfile = isSignedIn && !isAnonymousUser && Boolean(profile);
  const finalProgress = useMemo<StoredLevelProgress>(
    () => getStoredLevelProgress(profile?.level ?? 1, profile?.experience ?? 0),
    [profile?.experience, profile?.level],
  );
  const xpPlayback = useMemo<XpAnimationSegment[]>(() => {
    if (!profile?.lastXpGainAnimation) {
      return [];
    }

    const { fromLevel, fromExperience, toLevel, toExperience } =
      profile.lastXpGainAnimation;

    return buildXpAnimationSegments(
      fromLevel,
      fromExperience,
      toLevel,
      toExperience,
    );
  }, [profile?.lastXpGainAnimation]);
  const activePlaybackSegment = xpPlayback[playbackSegmentIndex] ?? null;
  const isPlaybackActive = Boolean(
    xpPlayback.length && !hasCompletedPlayback && activePlaybackSegment,
  );
  const displayedProgress = isPlaybackActive
    ? {
        currentLevel: displayedLeftLevel,
        nextLevel: displayedRightLevel,
        progressPercent: displayedFillPercent,
        xpGainedTowardCurrentLevel: activePlaybackSegment.startXp,
        xpRequiredForCurrentLevel: activePlaybackSegment.xpRequiredForLevel,
        xpRemainingToNextLevel: Math.max(
          0,
          activePlaybackSegment.xpRequiredForLevel - activePlaybackSegment.startXp,
        ),
      }
    : finalProgress;
  const showRewardPreview = isNextLevelMultipleOfFive(finalProgress.nextLevel);
  const totalLifetimeXp = useMemo(
    () =>
      getStoredLifetimeExperience(
        profile?.level ?? 1,
        profile?.experience ?? 0,
      ),
    [profile?.experience, profile?.level],
  );
  const progressionHelperText =
    `${finalProgress.xpGainedTowardCurrentLevel} / ` +
    `${finalProgress.xpRequiredForCurrentLevel} XP this level · ` +
    `${totalLifetimeXp} lifetime XP`;


  useEffect(() => {
    if (!isSettingsOpen || !isProfileOpen || xpPlayback.length === 0) {
      setPlaybackSegmentIndex(0);
      setDisplayedFillPercent(finalProgress.progressPercent);
      setDisplayedLeftLevel(finalProgress.currentLevel);
      setDisplayedRightLevel(finalProgress.nextLevel);
      setHasCompletedPlayback(xpPlayback.length === 0);
      return;
    }

    const firstSegment = xpPlayback[0];
    setPlaybackSegmentIndex(0);
    setDisplayedLeftLevel(firstSegment.labelCurrentLevel);
    setDisplayedRightLevel(firstSegment.labelNextLevel);
    setDisplayedFillPercent(firstSegment.startPercent);
    setHasCompletedPlayback(false);
  }, [
    finalProgress.currentLevel,
    finalProgress.nextLevel,
    finalProgress.progressPercent,
    isProfileOpen,
    isSettingsOpen,
    xpPlayback,
  ]);

  useEffect(() => {
    if (
      !isSettingsOpen ||
      !isProfileOpen ||
      hasCompletedPlayback ||
      !activePlaybackSegment
    ) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setDisplayedLeftLevel(activePlaybackSegment.labelCurrentLevel);
      setDisplayedRightLevel(activePlaybackSegment.labelNextLevel);
      setDisplayedFillPercent(activePlaybackSegment.endPercent);
    });

    const timeoutId = window.setTimeout(() => {
      if (playbackSegmentIndex >= xpPlayback.length - 1) {
        setHasCompletedPlayback(true);
        setDisplayedLeftLevel(finalProgress.currentLevel);
        setDisplayedRightLevel(finalProgress.nextLevel);
        setDisplayedFillPercent(finalProgress.progressPercent);
        return;
      }

      const nextSegment = xpPlayback[playbackSegmentIndex + 1];
      setPlaybackSegmentIndex((current) => current + 1);
      setDisplayedLeftLevel(nextSegment.labelCurrentLevel);
      setDisplayedRightLevel(nextSegment.labelNextLevel);
      setDisplayedFillPercent(nextSegment.startPercent);
    }, activePlaybackSegment.durationMs);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [
    activePlaybackSegment,
    finalProgress.currentLevel,
    finalProgress.nextLevel,
    finalProgress.progressPercent,
    hasCompletedPlayback,
    isProfileOpen,
    isSettingsOpen,
    playbackSegmentIndex,
    xpPlayback,
  ]);

  const handleProfileSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = profileName.trim();

    if (!trimmedName) {
      setProfileSaveMessage("Enter a display name before saving.");
      return;
    }

    try {
      setIsSavingProfile(true);
      setProfileSaveMessage(null);
      await updateProfile({ displayName: trimmedName });
      setProfileSaveMessage(`Saved as ${trimmedName}.`);
    } catch (error) {
      setProfileSaveMessage(
        error instanceof Error
          ? error.message
          : "Unable to save your profile right now.",
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  const podiumLabels = ["1st", "2nd", "3rd"];

  return (
    <main>
      {isSnowEnabled ? <SnowfallLayer height={"180%"} /> : null}
      <img
        className="welcome-div"
        src={heroBannerSrc}
        alt="Misty Hero Banner"
      />

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
              <img
                className="settings-icon"
                src="/leaderboard-icon.png"
                alt="Leaderboard icon"
              />
            </button>
            <button
              type="button"
              className="menu-action-button"
              aria-label="Open account and game settings"
              ref={settingsTriggerRef}
              onClick={() => setIsSettingsOpen(true)}
            >
              <img
                className="settings-icon"
                src="/profile.png"
                alt="Account settings icon"
              />
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
              <p>Update your profile and preferences.</p>
              {isProfileLoading ? (
                <p className="notice">Loading account settings…</p>
              ) : null}
              {!isProfileLoading && isSignedIn && !isAnonymousUser ? (
                <p className="notice">
                  Signed in as{" "}
                  {resolvedProfileName || authEmail || "Anonymous player"}.
                </p>
              ) : null}
              {profileError ? (
                <p className="notice">Profile error: {profileError}</p>
              ) : null}
              <button
                type="button"
                className="modal__section-dropdown"
                onClick={() => setIsProfileOpen((current) => !current)}
                aria-expanded={isProfileOpen}
                aria-controls="main-menu-profile-settings"
              >
                <span className="modal__section-dropdown-label">Profile</span>
                <span aria-hidden="true">{isProfileOpen ? "▾" : "▸"}</span>
              </button>
              <div
                id="main-menu-profile-settings"
                className={`modal__collapsible ${isProfileOpen ? "modal__collapsible--open" : ""}`}
                aria-hidden={!isProfileOpen}
              >
                <div className="modal__collapsible-content">
                  {canEditProfile ? (
                    <form
                      className="modal__profile-form"
                      onSubmit={(event) => void handleProfileSave(event)}
                    >
                      <div className="modal__option">
                        <label
                          className="modal__option-label"
                          htmlFor="settings-profile-name"
                        >
                          <span>Display name</span>
                        </label>
                        <input
                          id="settings-profile-name"
                          className="form-card-font modal__text-input"
                          type="text"
                          value={profileName}
                          onChange={(event) =>
                            setProfileName(event.target.value)
                          }
                          placeholder={authDisplayName ?? "Skye"}
                          disabled={isProfileLoading || isSavingProfile}
                        />
                        <p className="modal__option-help">
                          Choose the name other players see in lobbies and
                          completed games.
                        </p>
                      </div>
                      <div className="modal__option">
                        <div className="modal__option-label">
                          <span>Progression</span>
                        </div>
                        <div
                          className="profile-progression"
                          data-profile-open={isProfileOpen ? "true" : "false"}
                          aria-label={`Level ${displayedProgress.currentLevel} progression`}
                          style={
                            {
                              "--profile-progress-width": `${displayedProgress.progressPercent}%`,
                            } as CSSProperties
                          }
                        >
                          <div className="profile-progression__bar-row">
                            <span className="profile-progression__level-label">
                              Lv. {displayedProgress.currentLevel}
                            </span>
                            <div
                              className="profile-progression__bar"
                              role="progressbar"
                              aria-valuemin={0}
                              aria-valuemax={
                                displayedProgress.xpRequiredForCurrentLevel
                              }
                              aria-valuenow={
                                displayedProgress.xpGainedTowardCurrentLevel
                              }
                              aria-valuetext={`${displayedProgress.xpGainedTowardCurrentLevel} of ${displayedProgress.xpRequiredForCurrentLevel} XP toward level ${displayedProgress.nextLevel}`}
                            >
                              <span
                                className="profile-progression__fill"
                              />
                            </div>
                            <span className="profile-progression__level-label">
                              Lv. {displayedProgress.nextLevel}
                            </span>
                          </div>
                          <p className="modal__option-help">
                            {progressionHelperText}
                          </p>
                          <p className="modal__option-help">
                            {finalProgress.xpRemainingToNextLevel} XP until
                            level {finalProgress.nextLevel}.
                          </p>
                          {showRewardPreview ? (
                            <div
                              className="profile-progression__reward-preview"
                              aria-label={`Reward preview for level ${finalProgress.nextLevel}`}
                            >
                              <div
                                className="profile-progression__reward-cardback"
                                aria-hidden="true"
                              />
                              <div>
                                <p className="profile-progression__reward-title">
                                  Level {finalProgress.nextLevel} reward
                                  preview
                                </p>
                                <p className="modal__option-help">
                                  Reach this milestone to unlock the next
                                  cardback reward.
                                </p>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="modal__option">
                        <div className="modal__option-label">
                          <span>Last 5 Results</span>
                        </div>
                        {recentPlacements.length ? (
                          <>
                            <div
                              className="profile-results-list"
                              aria-label={`Last 5 results: ${recentPlacementSummary}`}
                            >
                              {recentPlacements.map((placement, index) => {
                                const badgeTone =
                                  placement <= 3 ? placement : 4;
                                return (
                                  <span
                                    key={`${placement}-${index}`}
                                    className={`profile-results-badge profile-results-badge--${badgeTone}`}
                                  >
                                    {formatPlacementLabel(placement)}
                                  </span>
                                );
                              })}
                            </div>
                            <p className="modal__option-help">
                              Recent finishes: {recentPlacementSummary}.
                            </p>
                          </>
                        ) : (
                          <p className="modal__option-help">
                            No completed games yet.
                          </p>
                        )}
                      </div>
                      <div className="modal__actions">
                        <button
                          className="form-button-full-width"
                          type="submit"
                          disabled={
                            !profileName.trim() ||
                            isProfileLoading ||
                            isSavingProfile
                          }
                        >
                          {isSavingProfile ? "Saving…" : "Save profile"}
                        </button>
                      </div>
                      {profileSaveMessage ? (
                        <p className="notice">{profileSaveMessage}</p>
                      ) : null}
                    </form>
                  ) : isSignedIn && !isAnonymousUser ? (
                    <div className="modal__option">
                      <p className="modal__option-help">
                        We&apos;re loading your saved profile and recent match
                        history.
                      </p>
                    </div>
                  ) : (
                    <div className="modal__option">
                      <p className="modal__option-help">
                        Sign in with Google to save your profile, keep your
                        match history, and see your last 5 games across devices.
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="modal__section-dropdown"
                onClick={() => setIsUiPreferencesOpen((current) => !current)}
                aria-expanded={isUiPreferencesOpen}
                aria-controls="main-menu-ui-preferences"
              >
                <span className="modal__section-dropdown-label">
                  UI Preferences
                </span>
                <span aria-hidden="true">
                  {isUiPreferencesOpen ? "▾" : "▸"}
                </span>
              </button>
              <div
                id="main-menu-ui-preferences"
                className={`modal__collapsible ${isUiPreferencesOpen ? "modal__collapsible--open" : ""}`}
                aria-hidden={!isUiPreferencesOpen}
              >
                <div className="modal__collapsible-content">
                  <div className="modal__option">
                    <label className="modal__option-label modal__option-toggle">
                      <span>Dark mode</span>
                      <span className="toggle">
                        <input
                          className="toggle__input"
                          type="checkbox"
                          checked={isDarkMode}
                          onChange={(event) =>
                            setPreference("darkMode", event.target.checked)
                          }
                        />
                        <span className="toggle__track" aria-hidden="true" />
                      </span>
                    </label>
                    <p className="modal__option-help">
                      Switch the interface to the dark theme.
                    </p>
                  </div>
                  <div className="modal__option">
                    <label className="modal__option-label modal__option-toggle">
                      <span>Let it snow</span>
                      <span className="toggle">
                        <input
                          className="toggle__input"
                          type="checkbox"
                          checked={isSnowEnabled}
                          onChange={(event) =>
                            setPreference("snow", event.target.checked)
                          }
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
                          onChange={(event) =>
                            setPreference("cardSounds", event.target.checked)
                          }
                        />
                        <span className="toggle__track" aria-hidden="true" />
                      </span>
                    </label>
                    <p className="modal__option-help">
                      Mute card draws, turn alerts, reveal sounds, and swap
                      effects.
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
                          onChange={(event) =>
                            setPreference(
                              "backgroundMusic",
                              event.target.checked,
                            )
                          }
                        />
                        <span className="toggle__track" aria-hidden="true" />
                      </span>
                    </label>
                    <p className="modal__option-help">
                      Play theme music during round breaks and in the lobby.
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="modal__section-dropdown"
                onClick={() => setIsAccessibilityOpen((current) => !current)}
                aria-expanded={isAccessibilityOpen}
                aria-controls="main-menu-accessibility-settings"
              >
                <span className="modal__section-dropdown-label">
                  Accessibility
                </span>
                <span aria-hidden="true">
                  {isAccessibilityOpen ? "▾" : "▸"}
                </span>
              </button>
              <div
                id="main-menu-accessibility-settings"
                className={`modal__collapsible ${isAccessibilityOpen ? "modal__collapsible--open" : ""}`}
                aria-hidden={!isAccessibilityOpen}
              >
                <div className="modal__collapsible-content">
                  <div className="modal__option">
                    <label className="modal__option-label modal__option-toggle">
                      <span>First time tips</span>
                      <span className="toggle">
                        <input
                          className="toggle__input"
                          type="checkbox"
                          checked={showFirstTimeTips}
                          onChange={(event) =>
                            setPreference("firstTimeTips", event.target.checked)
                          }
                        />
                        <span className="toggle__track" aria-hidden="true" />
                      </span>
                    </label>
                    <p className="modal__option-help">
                      Show the quick hints about revealing, replacing, and
                      swapping cards.
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
                          onChange={(event) =>
                            setPreference("autoFollow", event.target.checked)
                          }
                        />
                        <span className="toggle__track" aria-hidden="true" />
                      </span>
                    </label>
                    <p className="modal__option-help">
                      Automatically follow the active player after scrolling
                      settles.
                    </p>
                  </div>
                </div>
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
              <p className="leaderboard-sub mb-0">
                Lowest 10 scores of the season.
              </p>
              <p className="leaderboard-sub text-xs">
                Entries expire after 90 days
              </p>

              {!firebaseReady ? (
                <p>
                  Provide your Firebase environment variables to load
                  leaderboard results. Missing keys:{" "}
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
                          <span className="leaderboard-list__rank">
                            {index + 1}.
                          </span>
                        )}
                        <span className="leaderboard-list__name">
                          {entry.displayName}
                        </span>
                        <span className="leaderboard-list__score">
                          {entry.score}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="tiny-bold">
                  No scores yet. Finish a game to claim a spot!
                </p>
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
