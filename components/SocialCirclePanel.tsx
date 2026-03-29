"use client";

import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { usePreferences } from "../lib/preferences";
import {
  buildXpAnimationSegments,
  getStoredLevelProgress,
  getStoredLifetimeExperience,
  isNextLevelMultipleOfFive,
  type StoredLevelProgress,
  type XpAnimationSegment,
} from "../lib/progression";
import { useSocialPanel } from "../lib/useSocialPanel";
import { useUserProfile } from "../lib/useUserProfile";
import { formatPlacementLabel } from "../lib/userProfile";
import { useAnonymousAuth } from "../lib/auth";
import { db } from "../lib/firebase";
import { leaveGame } from "../lib/gameActions";
import { deleteSavedGameForUser } from "../lib/userSavedGamesRepo";
import { useParty } from "./LobbyProvider";

type SocialCirclePanelProps = {
  partyId: string | null;
  onLeaveParty?: (() => Promise<void>) | null;
  onEnsurePartyId?: (() => Promise<string>) | null;
};

type PartyLinkStatus = "idle" | "copying" | "copied" | "error";
type SocialLinkStatus = "idle" | "copying" | "copied" | "error";
type SocialModalTab = "social" | "preferences" | "profile";
const signInRoute = "/";
export default function SocialCirclePanel({
  partyId,
  onLeaveParty = null,
  onEnsurePartyId = null,
}: SocialCirclePanelProps) {
  const {
    friends,
    loading,
    error,
    inviteFriendToCurrentLobby,
    yourGames,
  } = useSocialPanel();
  const {
    profile,
    loading: isProfileLoading,
    error: profileError,
    authDisplayName,
    isSignedIn,
    isAnonymousUser,
    updateProfile,
    signInWithGoogleSso,
    signOutUser,
  } = useUserProfile();
  const { uid } = useAnonymousAuth();
  const { members } = useParty();
  const router = useRouter();
  const pathname = usePathname();
  const { preferences, setPreference } = usePreferences();
  const {
    firstTimeTips: showFirstTimeTips,
    darkMode: isDarkMode,
    cardSounds: isCardSoundsEnabled,
    backgroundMusic: isBackgroundMusicEnabled,
    snow: isSnowEnabled,
    autoFollow: isAutoFollowEnabled,
  } = preferences;

  const [activeTab, setActiveTab] = useState<SocialModalTab>("social");
  const [isUiPreferencesOpen, setIsUiPreferencesOpen] = useState(true);
  const [isAccessibilityOpen, setIsAccessibilityOpen] = useState(true);
  const [isLeavingParty, setIsLeavingParty] = useState(false);
  const [invitingFriendUid, setInvitingFriendUid] = useState<string | null>(null);
  const [joiningGameId, setJoiningGameId] = useState<string | null>(null);
  const [leavingGameId, setLeavingGameId] = useState<string | null>(null);
  const [confirmLeaveGameId, setConfirmLeaveGameId] = useState<string | null>(null);
  const [joinGameError, setJoinGameError] = useState<string | null>(null);
  const [leaveGameError, setLeaveGameError] = useState<string | null>(null);
  const [partyLinkStatus, setPartyLinkStatus] = useState<PartyLinkStatus>("idle");
  const [socialLinkStatus, setSocialLinkStatus] = useState<SocialLinkStatus>("idle");
  const [profileName, setProfileName] = useState("");
  const [profileSaveMessage, setProfileSaveMessage] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [playbackSegmentIndex, setPlaybackSegmentIndex] = useState(0);
  const [displayedPercent, setDisplayedPercent] = useState(0);
  const [progressTransitionDurationMs, setProgressTransitionDurationMs] = useState(0);
  const [progressTransitionTiming, setProgressTransitionTiming] = useState("ease");
  const [displayedLeftLevel, setDisplayedLeftLevel] = useState(1);
  const [displayedRightLevel, setDisplayedRightLevel] = useState(2);
  const [hasCompletedPlayback, setHasCompletedPlayback] = useState(false);
  const [xpReplayRunId, setXpReplayRunId] = useState(0);
  const [playbackAnnouncement, setPlaybackAnnouncement] = useState<string | null>(null);
  const playbackTimeoutRef = useRef<number | null>(null);
  const playbackFrameRef = useRef<number | null>(null);

  const currentGameId = useMemo(() => {
    const gameRouteMatch = pathname.match(/^\/game\/([^/]+)$/);
    if (!gameRouteMatch) {
      return null;
    }
    return decodeURIComponent(gameRouteMatch[1]);
  }, [pathname]);
  const sortedYourGames = useMemo(
    () =>
      [...yourGames].sort((leftGame, rightGame) => {
        const leftIsCurrent = leftGame.gameId === currentGameId;
        const rightIsCurrent = rightGame.gameId === currentGameId;
        if (leftIsCurrent !== rightIsCurrent) {
          return leftIsCurrent ? -1 : 1;
        }

        const leftUpdatedAt = leftGame.updatedAt ?? 0;
        const rightUpdatedAt = rightGame.updatedAt ?? 0;
        return rightUpdatedAt - leftUpdatedAt;
      }),
    [currentGameId, yourGames],
  );
  useEffect(() => {
    const nextProfileName = profile?.displayName?.trim() || authDisplayName?.trim() || "";
    setProfileName(nextProfileName);
  }, [authDisplayName, profile?.displayName]);

  useEffect(() => {
    setProfileSaveMessage(null);
  }, [profileName]);

  const persistedProfileName = profile?.displayName?.trim() || authDisplayName?.trim() || "";
  const hasDisplayNameChanged = profileName.trim() !== persistedProfileName;
  const canEditProfile = isSignedIn && (isAnonymousUser || Boolean(profile));
  const shouldShowProfileStats = !isAnonymousUser;
  const recentPlacements = profile?.lastFiveGames ?? [];
  const recentPlacementSummary = useMemo(
    () => recentPlacements.map((placement) => formatPlacementLabel(placement)).join(", "),
    [recentPlacements],
  );
  const finalProgress = useMemo<StoredLevelProgress>(
    () => getStoredLevelProgress(profile?.level ?? 1, profile?.experience ?? 0),
    [profile?.experience, profile?.level],
  );
  const latestXpAnimation = profile?.lastXpGainAnimation ?? null;
  const latestXpAnimationGameId = latestXpAnimation?.gameId ?? null;
  const xpPlayback = useMemo<XpAnimationSegment[]>(() => {
    if (!latestXpAnimation) {
      return [];
    }

    const { fromLevel, fromExperience, toLevel, toExperience } = latestXpAnimation;
    return buildXpAnimationSegments(fromLevel, fromExperience, toLevel, toExperience);
  }, [latestXpAnimation]);
  const activePlaybackSegment = xpPlayback[playbackSegmentIndex] ?? null;
  const canReplayLatestXpAnimation = Boolean(latestXpAnimationGameId && xpPlayback.length);
  const shouldPlayXpAnimation = activeTab === "profile" && xpPlayback.length > 0;
  const isPlaybackActive = Boolean(shouldPlayXpAnimation && !hasCompletedPlayback && activePlaybackSegment);
  const displayedProgress = isPlaybackActive
    ? {
      currentLevel: displayedLeftLevel,
      nextLevel: displayedRightLevel,
      progressPercent: displayedPercent,
      xpGainedTowardCurrentLevel: activePlaybackSegment.startXp,
      xpRequiredForCurrentLevel: activePlaybackSegment.xpRequiredForLevel,
      xpRemainingToNextLevel: Math.max(0, activePlaybackSegment.xpRequiredForLevel - activePlaybackSegment.startXp),
    }
    : finalProgress;
  const showRewardPreview = isNextLevelMultipleOfFive(finalProgress.nextLevel);
  const totalLifetimeXp = useMemo(
    () => getStoredLifetimeExperience(profile?.level ?? 1, profile?.experience ?? 0),
    [profile?.experience, profile?.level],
  );
  const progressionHelperText =
    `${finalProgress.xpGainedTowardCurrentLevel} / ${finalProgress.xpRequiredForCurrentLevel} XP this level · ${totalLifetimeXp} lifetime XP`;
  const xpReplayStatusText = latestXpAnimation ? `+${latestXpAnimation.awardedXp} XP from your last game` : null;
  const displayedProgressionHelperText =
    isPlaybackActive && playbackAnnouncement ? playbackAnnouncement : progressionHelperText;

  useEffect(() => {
    if (!shouldPlayXpAnimation || xpPlayback.length === 0) {
      setPlaybackSegmentIndex(0);
      setDisplayedPercent(finalProgress.progressPercent);
      setProgressTransitionDurationMs(0);
      setProgressTransitionTiming("ease");
      setDisplayedLeftLevel(finalProgress.currentLevel);
      setDisplayedRightLevel(finalProgress.nextLevel);
      setHasCompletedPlayback(xpPlayback.length === 0);
      setPlaybackAnnouncement(null);
      return;
    }

    const firstSegment = xpPlayback[0];
    setPlaybackSegmentIndex(0);
    setDisplayedLeftLevel(firstSegment.labelCurrentLevel);
    setDisplayedRightLevel(firstSegment.labelNextLevel);
    setDisplayedPercent(firstSegment.startPercent);
    setProgressTransitionDurationMs(0);
    setProgressTransitionTiming("ease");
    setHasCompletedPlayback(false);
    setPlaybackAnnouncement(null);
  }, [
    finalProgress.currentLevel,
    finalProgress.nextLevel,
    finalProgress.progressPercent,
    shouldPlayXpAnimation,
    xpPlayback,
    xpReplayRunId,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (playbackTimeoutRef.current !== null) {
      window.clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    if (playbackFrameRef.current !== null) {
      window.cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    }

    if (!shouldPlayXpAnimation) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches || hasCompletedPlayback || !activePlaybackSegment) {
      if (mediaQuery.matches) {
        setHasCompletedPlayback(true);
        setDisplayedLeftLevel(finalProgress.currentLevel);
        setDisplayedRightLevel(finalProgress.nextLevel);
        setDisplayedPercent(finalProgress.progressPercent);
        setProgressTransitionDurationMs(0);
        setProgressTransitionTiming("ease");
        setPlaybackAnnouncement(null);
      }
      return;
    }

    const dramaticEasing = "cubic-bezier(0.65, 0, 0.35, 1)";
    const boundaryPauseMs = activePlaybackSegment.isLevelUpBoundary ? 280 : 0;
    setDisplayedLeftLevel(activePlaybackSegment.labelCurrentLevel);
    setDisplayedRightLevel(activePlaybackSegment.labelNextLevel);
    setDisplayedPercent(activePlaybackSegment.startPercent);
    setProgressTransitionDurationMs(0);
    setProgressTransitionTiming("linear");

    playbackFrameRef.current = window.requestAnimationFrame(() => {
      setProgressTransitionDurationMs(activePlaybackSegment.durationMs);
      setProgressTransitionTiming(dramaticEasing);
      setDisplayedPercent(activePlaybackSegment.endPercent);
      playbackFrameRef.current = null;
    });

    playbackTimeoutRef.current = window.setTimeout(() => {
      playbackTimeoutRef.current = null;

      if (playbackSegmentIndex >= xpPlayback.length - 1) {
        setHasCompletedPlayback(true);
        setPlaybackAnnouncement(null);
        setDisplayedLeftLevel(finalProgress.currentLevel);
        setDisplayedRightLevel(finalProgress.nextLevel);
        setDisplayedPercent(finalProgress.progressPercent);
        setProgressTransitionDurationMs(0);
        setProgressTransitionTiming("ease-out");
        return;
      }

      const nextSegment = xpPlayback[playbackSegmentIndex + 1];
      if (activePlaybackSegment.isLevelUpBoundary) {
        setPlaybackAnnouncement(
          `Level up! Lv. ${activePlaybackSegment.labelCurrentLevel} → Lv. ${nextSegment.labelCurrentLevel}`,
        );
        setDisplayedLeftLevel(nextSegment.labelCurrentLevel);
        setDisplayedRightLevel(nextSegment.labelNextLevel);
        setProgressTransitionDurationMs(0);
        setProgressTransitionTiming("linear");
        setDisplayedPercent(0);
      } else {
        setPlaybackAnnouncement(null);
      }

      playbackTimeoutRef.current = window.setTimeout(() => {
        playbackTimeoutRef.current = null;
        setPlaybackAnnouncement(null);
        setPlaybackSegmentIndex((current) => current + 1);
      }, boundaryPauseMs);
    }, activePlaybackSegment.durationMs);

    return () => {
      if (playbackTimeoutRef.current !== null) {
        window.clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = null;
      }
      if (playbackFrameRef.current !== null) {
        window.cancelAnimationFrame(playbackFrameRef.current);
        playbackFrameRef.current = null;
      }
    };
  }, [
    activePlaybackSegment,
    finalProgress.currentLevel,
    finalProgress.nextLevel,
    finalProgress.progressPercent,
    hasCompletedPlayback,
    playbackSegmentIndex,
    shouldPlayXpAnimation,
    xpPlayback,
  ]);

  const onClickLeaveParty = async () => {
    if (!partyId || !onLeaveParty || isLeavingParty) {
      return;
    }

    setIsLeavingParty(true);
    try {
      await onLeaveParty();
    } finally {
      setIsLeavingParty(false);
    }
  };

  const onClickSharePartyLink = async () => {
    if (partyLinkStatus === "copying") {
      return;
    }

    const resolvedPartyId = partyId ?? (onEnsurePartyId ? await onEnsurePartyId() : null);
    if (!resolvedPartyId) {
      setPartyLinkStatus("error");
      return;
    }

    setPartyLinkStatus("copying");
    try {
      const params = new URLSearchParams({ joinPartyId: resolvedPartyId });
      const partyJoinUrl = `${window.location.origin}${signInRoute}?${params.toString()}`;
      await navigator.clipboard.writeText(partyJoinUrl);
      setPartyLinkStatus("copied");
    } catch {
      setPartyLinkStatus("error");
    }
  };

  const onClickInviteFriend = async (friendUid: string) => {
    if (invitingFriendUid) {
      return;
    }

    const resolvedPartyId = partyId ?? (onEnsurePartyId ? await onEnsurePartyId() : null);
    if (!resolvedPartyId) {
      return;
    }

    setInvitingFriendUid(friendUid);
    try {
      await inviteFriendToCurrentLobby(friendUid, resolvedPartyId);
    } finally {
      setInvitingFriendUid(null);
    }
  };

  const onClickJoinSavedGame = async (savedGameId: string, savedPartyId: string | null, savedPlayerIds: string[]) => {
    if (!uid || joiningGameId) {
      return;
    }

    const isAloneWithoutParty = !partyId;
    const isAloneInParty = Boolean(partyId && members.length === 1);
    const isExactPartyMatch =
      Boolean(partyId) &&
      members.length > 1 &&
      members.length === savedPlayerIds.length &&
      members.every((member) => savedPlayerIds.includes(member.id));
    const canJoin = isAloneWithoutParty || isAloneInParty || isExactPartyMatch;
    if (!canJoin) {
      setJoinGameError(
        "You can only rejoin with an exactly matching party, alone in a party, or while solo.",
      );
      return;
    }

    setJoiningGameId(savedGameId);
    setJoinGameError(null);
    try {
      const gameRef = doc(db, "games", savedGameId);
      const gameSnapshot = await getDoc(gameRef);
      if (!gameSnapshot.exists()) {
        await deleteSavedGameForUser(uid, savedGameId);
        throw new Error("This saved game no longer exists.");
      }

      const gameData = gameSnapshot.data() as Record<string, unknown>;
      const gameStatus = typeof gameData.status === "string" ? gameData.status : "playing";
      if (gameStatus === "game-complete") {
        await deleteSavedGameForUser(uid, savedGameId);
        throw new Error("This game is already finished.");
      }

      if (partyId) {
        await setDoc(
          doc(db, "parties", partyId),
          {
            status: "in-game",
            activeGameId: savedGameId,
            gameId: savedGameId,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } else if (savedPartyId) {
        await setDoc(
          gameRef,
          {
            partyId: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }

      router.push(`/game/${savedGameId}`);
    } catch (joinError) {
      const message = joinError instanceof Error ? joinError.message : "Could not rejoin that game.";
      setJoinGameError(message);
    } finally {
      setJoiningGameId(null);
    }
  };

  const onClickConfirmLeaveSavedGame = async () => {
    if (!uid || !confirmLeaveGameId || leavingGameId) {
      return;
    }

    setLeavingGameId(confirmLeaveGameId);
    setLeaveGameError(null);
    try {
      try {
        await leaveGame(confirmLeaveGameId, uid);
      } catch (leaveError) {
        const leaveMessage = leaveError instanceof Error ? leaveError.message : "";
        const isAlreadyRemoved =
          leaveMessage === "Player is not active in this game." || leaveMessage === "Player state not found.";
        if (!isAlreadyRemoved) {
          throw leaveError;
        }
      }

      await deleteSavedGameForUser(uid, confirmLeaveGameId);
      setConfirmLeaveGameId(null);
    } catch (leaveError) {
      const message = leaveError instanceof Error ? leaveError.message : "Could not leave that game.";
      setLeaveGameError(message);
    } finally {
      setLeavingGameId(null);
    }
  };

  const onClickCopySocialLink = async () => {
    if (!uid || socialLinkStatus === "copying") {
      return;
    }

    setSocialLinkStatus("copying");
    try {
      const params = new URLSearchParams({ friendInviteFrom: uid });
      const socialInviteUrl = `${window.location.origin}${signInRoute}?${params.toString()}`;
      await navigator.clipboard.writeText(socialInviteUrl);
      setSocialLinkStatus("copied");
    } catch {
      setSocialLinkStatus("error");
    }
  };

  const handleProfileSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = profileName.trim();

    if (!trimmedName) {
      setProfileSaveMessage("Enter a display name before saving.");
      return;
    }

    if (!hasDisplayNameChanged) {
      setProfileSaveMessage("Your display name is already up to date.");
      return;
    }

    try {
      setIsSavingProfile(true);
      setProfileSaveMessage(null);
      await updateProfile({ displayName: trimmedName });
      setProfileSaveMessage(`Saved as ${trimmedName}.`);
    } catch (saveError) {
      setProfileSaveMessage(
        saveError instanceof Error ? saveError.message : "Unable to save your profile right now.",
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
      setProfileSaveMessage(null);
    } catch (signOutError) {
      setProfileSaveMessage(
        signOutError instanceof Error ? signOutError.message : "Unable to sign out right now.",
      );
    }
  };

  const partyLinkStatusText =
    partyLinkStatus === "copied"
      ? "Copied!"
      : partyLinkStatus === "error"
        ? "Couldn't copy party link."
        : partyLinkStatus === "copying"
          ? "Copying…"
          : null;
  const socialLinkStatusText =
    socialLinkStatus === "copied"
      ? "Copied!"
      : socialLinkStatus === "error"
        ? "Couldn't copy social link."
        : socialLinkStatus === "copying"
          ? "Copying…"
          : null;

  return (
    <div className="social-circle-panel">
      <div className="social-circle-panel__tabs" role="tablist" aria-label="Social panel sections">
        {(["social", "preferences", "profile"] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={activeTab === tabKey}
            className={`social-circle-panel__tab ${activeTab === tabKey ? "social-circle-panel__tab--active" : ""}`}
            onClick={() => setActiveTab(tabKey)}
          >
            {tabKey === "social" ? "Social" : tabKey === "preferences" ? "Settings" : "Profile"}
          </button>
        ))}
      </div>

      {activeTab === "social" ? (
        <>
          <div className="social-circle-panel__bento active-panel">
            <button                 disabled={!uid || socialLinkStatus === "copying"}
onClick={() => {
                  void onClickCopySocialLink();
                }} className="social-circle-panel__section social-circle-panel__section--social-link">
                {socialLinkStatus === "copying" ? "Copying…" : "Your social link"}
              {socialLinkStatusText ? <p className="notice">{socialLinkStatusText}</p> : null}
            </button>

            <div className="social-circle-panel__section social-circle-panel__section--friends">
              <div className="social-circle-panel__friends-header">
                <h3 className="social-circle-panel__heading">Friends ({friends.length})</h3>
                {isAnonymousUser ? (
                  <button
                    type="button"
                    className="modal__inline-save-button"
                    onClick={() => {
                      void signInWithGoogleSso();
                    }}
                  >
                    Sign in with Google SSO
                  </button>
                ) : null}
              </div>
              <div
                className={`social-circle-panel__list social-circle-panel__list--scroll ${isAnonymousUser ? "social-circle-panel__list--disabled" : ""}`}
                role="list"
                aria-disabled={isAnonymousUser}
              >
                {isAnonymousUser ? <p className="notice">Sign in with Google SSO to unlock friends.</p> : null}
                {friends.length === 0 ? <p className="notice">No friends yet.</p> : null}
                {friends.map((friend) => (
                  <article key={friend.uid} className="social-circle-panel__row" role="listitem">
                    <p className="social-circle-panel__row-text">{friend.displayName}</p>
                    <div className="social-circle-panel__row-actions">
                      <button
                        type="button"
                        className="modal__inline-save-button"
                        onClick={() => {
                          void onClickInviteFriend(friend.uid);
                        }}
                        disabled={Boolean(invitingFriendUid) || isAnonymousUser}
                      >
                        {invitingFriendUid === friend.uid ? "Inviting…" : "Invite to Lobby"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="social-circle-panel__section social-circle-panel__section--games">
              <h3 className="social-circle-panel__heading">Games ({yourGames.length})</h3>
              <div className="social-circle-panel__list social-circle-panel__list--scroll" role="list">
                {sortedYourGames.length === 0 ? <p className="">No unfinished games saved.</p> : null}
                {sortedYourGames.map((savedGame) => (
                  <article key={savedGame.gameId} className="social-circle-panel__row" role="listitem">
                    <p className="social-circle-panel__row-text">
                      {savedGame.playerNames.join(", ") || "Unnamed players"}
                    </p>
                    <div className="social-circle-panel__row-actions">
                      {savedGame.gameId === currentGameId ? (
                        <span className="social-circle-panel__badge">Current</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="modal__inline-save-button"
                            onClick={() => {
                              void onClickJoinSavedGame(savedGame.gameId, savedGame.partyId, savedGame.playerIds);
                            }}
                            disabled={Boolean(joiningGameId) || Boolean(leavingGameId)}
                          >
                            {joiningGameId === savedGame.gameId ? "Joining…" : "Rejoin"}
                          </button>
                          <button
                            type="button"
                            className="modal__inline-save-button"
                            onClick={() => {
                              setLeaveGameError(null);
                              setConfirmLeaveGameId(savedGame.gameId);
                            }}
                            disabled={Boolean(joiningGameId) || Boolean(leavingGameId)}
                          >
                            {leavingGameId === savedGame.gameId ? "Leaving…" : "Leave game"}
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            {partyId || onEnsurePartyId ? (
              <div className="social-circle-panel__section social-circle-panel__section--party-actions">
                <button
                  type="button"
                  className="social-circle-panel__section--social-link social-circle-panel__toggle"
                  onClick={() => {
                    void onClickSharePartyLink();
                  }}
                  disabled={partyLinkStatus === "copying" || (!partyId && !onEnsurePartyId)}
                >
                  {partyLinkStatus === "copying" ? "Copying…" : "Copy party invite link"}
                </button>
                {partyId ? (
                  <button
                    type="button"
                    className="social-circle-panel__section--party-link social-circle-panel__toggle"
                    onClick={() => {
                      void onClickLeaveParty();
                    }}
                    disabled={isLeavingParty || !onLeaveParty}
                  >
                    {isLeavingParty ? "Leaving party…" : "Leave party"}
                  </button>
                ) : null}
                {partyLinkStatusText ? <p className="notice">{partyLinkStatusText}</p> : null}
              </div>
            ) : null}
          </div>

          {loading && friends.length === 0 ? <p className="notice">Loading social panel…</p> : null}
          {joinGameError ? <p className="notice">{joinGameError}</p> : null}
          {leaveGameError ? <p className="notice">{leaveGameError}</p> : null}
          {error ? <p className="notice">{error}</p> : null}
        </>
      ) : null}

      {activeTab === "preferences" ? (
        <>
          <div className="social-circle-panel__section">
            <button
              type="button"
              className="modal__section-dropdown"
              onClick={() => setIsUiPreferencesOpen((current) => !current)}
              aria-expanded={isUiPreferencesOpen}
              aria-controls="social-ui-preferences"
            >
              <span className="modal__section-dropdown-label">UI Preferences</span>
              <span aria-hidden="true">{isUiPreferencesOpen ? "▾" : "▸"}</span>
            </button>
            <div
              id="social-ui-preferences"
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
                  <p className="modal__option-help">Sprinkle a light snowfall across the screen.</p>
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
                  <p className="modal__option-help">Mute card draws, turn alerts, reveal sounds, and swap effects.</p>
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
                  <p className="modal__option-help">Play theme music during round breaks and in the lobby.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="social-circle-panel__section">
            <button
              type="button"
              className="modal__section-dropdown"
              onClick={() => setIsAccessibilityOpen((current) => !current)}
              aria-expanded={isAccessibilityOpen}
              aria-controls="social-accessibility-settings"
            >
              <span className="modal__section-dropdown-label">Accessibility</span>
              <span aria-hidden="true">{isAccessibilityOpen ? "▾" : "▸"}</span>
            </button>
            <div
              id="social-accessibility-settings"
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
                        onChange={(event) => setPreference("firstTimeTips", event.target.checked)}
                      />
                      <span className="toggle__track" aria-hidden="true" />
                    </span>
                  </label>
                  <p className="modal__option-help">Show the quick hints about revealing, replacing, and swapping cards.</p>
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
                  <p className="modal__option-help">Automatically follow the active player after scrolling settles.</p>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {activeTab === "profile" ? (
        <section className="social-circle-panel__section">
          {isProfileLoading ? <p className="notice">Loading account settings…</p> : null}
          {profileError ? <p className="notice">Profile error: {profileError}</p> : null}
          {canEditProfile ? (
            <form className="modal__profile-form" onSubmit={(event) => void handleProfileSave(event)}>
              <div className="modal__option">
                <label className="modal__option-label" htmlFor="social-profile-name">
                  <span>Display name</span>
                </label>
                <div className="modal__text-input-row">
                  <input
                    id="social-profile-name"
                    className="form-card-font modal__text-input"
                    type="text"
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder={authDisplayName ?? "Skye"}
                    disabled={isProfileLoading || isSavingProfile}
                  />
                  <button
                    className="modal__inline-save-button"
                    type="submit"
                    disabled={!profileName.trim() || !hasDisplayNameChanged || isProfileLoading || isSavingProfile}
                  >
                    {isSavingProfile ? "Saving…" : "Save"}
                  </button>
                </div>
                <p className="modal__option-help">Choose the name other players see in lobbies and completed games.</p>
              </div>
              {shouldShowProfileStats ? (
                <>
                  <div className="modal__option">
                    <div className="modal__option-label">
                      <span>Progression</span>
                    </div>
                    <div
                      className="profile-progression"
                      aria-label={`Level ${displayedProgress.currentLevel} progression`}
                      style={
                        {
                          "--profile-progress-width": `${displayedPercent}%`,
                          "--profile-progress-duration": `${progressTransitionDurationMs}ms`,
                          "--profile-progress-easing": progressTransitionTiming,
                        } as CSSProperties
                      }
                    >
                      <div className="profile-progression__bar-row">
                        <span className="profile-progression__level-label">Lv. {displayedProgress.currentLevel}</span>
                        <div
                          className="profile-progression__bar"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={displayedProgress.xpRequiredForCurrentLevel}
                          aria-valuenow={displayedProgress.xpGainedTowardCurrentLevel}
                          aria-valuetext={`${displayedProgress.xpGainedTowardCurrentLevel} of ${displayedProgress.xpRequiredForCurrentLevel} XP toward level ${displayedProgress.nextLevel}`}
                        >
                          <span className="profile-progression__fill" />
                        </div>
                        <span className="profile-progression__level-label">Lv. {displayedProgress.nextLevel}</span>
                      </div>
                      <p className="modal__option-help">{displayedProgressionHelperText}</p>
                      <p className="modal__option-help">
                        {finalProgress.xpRemainingToNextLevel} XP until level {finalProgress.nextLevel}.
                      </p>
                      {showRewardPreview ? (
                        <div
                          className="profile-progression__reward-preview"
                          aria-label={`Reward preview for level ${finalProgress.nextLevel}`}
                        >
                          <div className="profile-progression__reward-cardback" aria-hidden="true" />
                          <div>
                            <p className="profile-progression__reward-title">Level {finalProgress.nextLevel} reward preview</p>
                            <p className="modal__option-help">
                              Reach this milestone to unlock the next cardback reward.
                            </p>
                          </div>
                        </div>
                      ) : null}
                      <div className="social-circle-panel__row-actions">
                        {canReplayLatestXpAnimation ? (
                          <button
                            type="button"
                            className="profile-progression__replay-button"
                            onClick={() => {
                              setHasCompletedPlayback(false);
                              setXpReplayRunId((current) => current + 1);
                            }}
                          >
                            Replay XP gain
                          </button>
                        ) : null}
                        {xpReplayStatusText ? <p className="modal__option-help">{xpReplayStatusText}</p> : null}
                      </div>
                    </div>
                  </div>

                  <div className="modal__option">
                    <div className="modal__option-label">
                      <span>Last 5 Results</span>
                    </div>
                    {recentPlacements.length ? (
                      <>
                        <div className="profile-results-list" aria-label={`Last 5 results: ${recentPlacementSummary}`}>
                          {recentPlacements.map((placement, index) => {
                            const badgeTone = placement <= 3 ? placement : 4;
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
                        <p className="modal__option-help">Recent finishes: {recentPlacementSummary}.</p>
                      </>
                    ) : (
                      <p className="modal__option-help">No completed games yet.</p>
                    )}
                  </div>
                </>
              ) : null}

              {profileSaveMessage ? <p className="notice">{profileSaveMessage}</p> : null}
              {isAnonymousUser ? (
                <div className="modal__actions modal__actions--stacked">
                  <button type="button" className="modal__sign-out-button" onClick={() => void signInWithGoogleSso()}>
                    Sign in with Google
                  </button>
                  <p className="modal__option-help">
                    Sign in with Google to save your profile, keep your match history, and see your last 5 games across
                    devices.
                  </p>
                </div>
              ) : null}
              <div className="modal__actions modal__actions--stacked">
                <button type="button" className="modal__sign-out-button" onClick={() => void handleSignOut()}>
                  Sign out
                </button>
              </div>
            </form>
          ) : (
            <div className="modal__option">
              <p className="modal__option-help">We&apos;re loading your saved profile and recent match history.</p>
            </div>
          )}
        </section>
      ) : null}

      {confirmLeaveGameId ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!leavingGameId) {
              setConfirmLeaveGameId(null);
            }
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-saved-game-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="leave-saved-game-title">Leave this saved game?</h3>
            <p className="notice">
              You&apos;ll be removed from this game, and it will be deleted from your saved games list.
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="modal__inline-save-button"
                onClick={() => setConfirmLeaveGameId(null)}
                disabled={Boolean(leavingGameId)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal__inline-save-button"
                onClick={() => {
                  void onClickConfirmLeaveSavedGame();
                }}
                disabled={Boolean(leavingGameId)}
              >
                {leavingGameId ? "Leaving…" : "Leave game"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
