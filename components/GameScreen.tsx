"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  Timestamp,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import PlayerGrid from "./PlayerGrid";
import SnowfallLayer from "./SnowfallLayer";
import {
  discardAndRevealPendingDraw,
  discardItemForReveal,
  drawFromDeck,
  leaveGame,
  drawFromDiscard,
  revealAfterDiscard,
  readyForNextRound,
  selectDiscard,
  startNextRound,
  submitEndGameTurnTime,
  swapPendingDraw,
  useItemCard,
} from "../lib/gameActions";
import { useAnonymousAuth } from "../lib/auth";
import type {
  Card,
  ItemCard,
  ItemCode,
  SpikeItemCount,
} from "../lib/game/deck";
import { getModeDetails, getModeLabel } from "../lib/game/modeLabels";
import {
  db,
  isFirebaseConfigured,
  missingFirebaseConfig,
} from "../lib/firebase";
import { usePreferences } from "../lib/preferences";
import LoadingSwipeOverlay from "./LoadingSwipeOverlay";
import {
  CRITICAL_PRELOAD_GROUP_LABELS,
  PRELOAD_PRIORITY_GROUPS,
} from "../lib/assetPreloadManifest";
import {
  clampLastFiveGames,
  type UserProfileGamePlacement,
  type UserProfileLastXpGainAnimation,
} from "../lib/userProfile";
import {
  applyEarnedExperience,
  getNewlyUnlockedRewardIds,
  getTotalEarnedXpBreakdown,
  isNextLevelMultipleOfFive,
} from "../lib/progression";

type GameScreenProps = {
  gameId: string;
};

type GameMeta = {
  status: string;
  lobbyId: string | null;
  currentPlayerId: string | null;
  activePlayerOrder: string[];
  deck: Card[];
  discard: Card[];
  hostId: string | null;
  roundNumber: number;
  turnPhase: string;
  spikeMode: boolean;
  spikeItemCount?: SpikeItemCount;
  spikeRowClear?: boolean;
  spikeEndGameBonuses?: boolean;
  targetScore?: 50 | 100;
  endingPlayerId: string | null;
  finalTurnRemainingIds: string[] | null;
  selectedDiscardPlayerId: string | null;
  roundScores?: Record<string, number>;
  roundClearingPlayerIds?: string[];
  lastTurnPlayerId?: string | null;
  lastTurnAction?: string | null;
  lastTurnActionAt?: Timestamp | null;
  lastClearType?: "row" | "column" | "row-column" | null;
  lastClearTypeAt?: Timestamp | null;
  endGameBonusResults?: {
    mostRowsClearedWinnerId?: string | null;
    lowestDiscardedWinnerId?: string | null;
    fastestPlayerWinnerId?: string | null;
  } | null;
  turnTimeSubmissionsMs?: Record<string, number>;
};

type GamePlayerSummary = {
  id: string;
  displayName: string;
  isReady: boolean;
  totalScore?: number;
  revealedCount?: number;
  mistTurnsRemaining?: number | null;
  sprintTurnsRemaining?: number | null;
  publicGrid?: Array<Card | null>;
  revealed?: boolean[];
  pendingDraw?: Card | null;
  pendingDrawSource?: "deck" | "discard" | null;
  pointsClearedFromRows?: number;
  pointsDiscarded?: number;
  discardedCardCount?: number;
  revealedCardValueTotal?: number;
  revealedCardCount?: number;
  itemCardsDrawn?: number;
  roundSpiked?: boolean;
};

type GamePlayerState = {
  grid?: Array<Card | null>;
  revealed?: boolean[];
  pendingDraw?: Card | null;
  pendingDrawSource?: "deck" | "discard" | null;
  sprintTurnsRemaining?: number | null;
};

type GamePlayer = GamePlayerSummary & GamePlayerState;

type LeaderboardEntry = {
  id: string;
  displayName: string;
  score: number;
  gameId?: string | null;
  playerId?: string | null;
};

type ItemTarget = {
  playerId: string;
  index: number;
};

type ItemSelectionTarget = ItemTarget;

const BETWEEN_ROUNDS_FADE_IN_SECONDS = 1.5;
const BETWEEN_ROUNDS_TARGET_VOLUME = 1;
const BONUS_ANNOUNCEMENT_DURATION_MS = 2800;
const LEADERBOARD_ENTRY_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function isLeaderboardEntryActive(expiresAt: unknown) {
  return expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now();
}

const formatTurnLength = (milliseconds: number) => {
  const safeMilliseconds = Number.isFinite(milliseconds)
    ? Math.max(0, Math.round(milliseconds))
    : 0;
  const totalSeconds = Math.floor(safeMilliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatAverageValue = (total: number, count: number) => {
  if (count <= 0) {
    return "-";
  }
  return (Math.round((total / count) * 10) / 10).toFixed(1);
};

type FinalScoreEntry = {
  id: string;
  displayName: string;
  totalScore: number;
};

type LocalPlayerExperiencePreview = {
  awardedXp: number;
  previousLevel: number;
  currentLevel: number;
  xpGainedTowardCurrentLevel: number;
  xpRequiredForCurrentLevel: number;
  xpRemainingToNextLevel: number;
  nextLevel: number;
  leveledUp: boolean;
  unlockedRewardLevels: number[];
  showRewardPreview: boolean;
};

function buildExperienceAwardPreview(
  level: number,
  experience: number,
  awardedXp: number,
): LocalPlayerExperiencePreview {
  const previousLevel = Number.isFinite(level)
    ? Math.max(1, Math.floor(level))
    : 1;
  const normalizedAwardedXp = Number.isFinite(awardedXp)
    ? Math.max(0, Math.floor(awardedXp))
    : 0;
  const updatedProgress = applyEarnedExperience(
    previousLevel,
    experience,
    normalizedAwardedXp,
  );
  const unlockedRewardLevels = getNewlyUnlockedRewardIds(
    previousLevel,
    updatedProgress.currentLevel,
  )
    .map((rewardId) => {
      const matchedLevel = /^level-(\d+)-reward$/.exec(rewardId)?.[1];
      return matchedLevel ? Number.parseInt(matchedLevel, 10) : null;
    })
    .filter((levelValue): levelValue is number => Number.isFinite(levelValue));

  return {
    awardedXp: normalizedAwardedXp,
    previousLevel,
    currentLevel: updatedProgress.currentLevel,
    xpGainedTowardCurrentLevel: updatedProgress.xpGainedTowardCurrentLevel,
    xpRequiredForCurrentLevel: updatedProgress.xpRequiredForCurrentLevel,
    xpRemainingToNextLevel: updatedProgress.xpRemainingToNextLevel,
    nextLevel: updatedProgress.nextLevel,
    leveledUp: updatedProgress.currentLevel > previousLevel,
    unlockedRewardLevels,
    showRewardPreview: isNextLevelMultipleOfFive(updatedProgress.nextLevel),
  };
}

async function updateCompletedGameProfile({
  gameId,
  finalScores,
  playerSummaries,
  uid,
}: {
  gameId: string;
  finalScores: FinalScoreEntry[];
  playerSummaries: GamePlayerSummary[];
  uid: string;
}): Promise<LocalPlayerExperiencePreview | null> {
  const playerPlacement = finalScores.findIndex((entry) => entry.id === uid);
  if (playerPlacement < 0) {
    return null;
  }

  const localPlayerSummary =
    playerSummaries.find((player) => player.id === uid) ?? null;
  const earnedXp = getTotalEarnedXpBreakdown({
    finalRank: playerPlacement + 1,
    lobbySize: Math.max(finalScores.length, 2),
    pointsClearedFromRows: localPlayerSummary?.pointsClearedFromRows ?? 0,
  });

  const userRef = doc(db, "users", uid);

  return runTransaction(db, async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const existingData = userSnapshot.data();
    const rewardedGameIds = Array.isArray(existingData?.rewardedGameIds)
      ? existingData.rewardedGameIds.filter(
          (rewardedGameId): rewardedGameId is string =>
            typeof rewardedGameId === "string",
        )
      : [];

    if (rewardedGameIds.includes(gameId)) {
      const existingLevel =
        typeof existingData?.level === "number" ? existingData.level : 1;
      const existingExperience =
        typeof existingData?.experience === "number"
          ? existingData.experience
          : 0;
      const existingProgress = buildExperienceAwardPreview(
        existingLevel,
        existingExperience,
        0,
      );
      return {
        awardedXp: existingProgress.awardedXp,
        previousLevel: existingProgress.previousLevel,
        currentLevel: existingProgress.currentLevel,
        xpGainedTowardCurrentLevel:
          existingProgress.xpGainedTowardCurrentLevel,
        xpRequiredForCurrentLevel: existingProgress.xpRequiredForCurrentLevel,
        xpRemainingToNextLevel: existingProgress.xpRemainingToNextLevel,
        nextLevel: existingProgress.nextLevel,
        leveledUp: existingProgress.leveledUp,
        unlockedRewardLevels: existingProgress.unlockedRewardLevels,
        showRewardPreview: existingProgress.showRewardPreview,
      } satisfies LocalPlayerExperiencePreview;
    }

    const existingLastFiveGames = Array.isArray(existingData?.lastFiveGames)
      ? (existingData.lastFiveGames as UserProfileGamePlacement[])
      : [];
    const existingLevel =
      typeof existingData?.level === "number" ? existingData.level : 1;
    const existingExperience =
      typeof existingData?.experience === "number"
        ? existingData.experience
        : 0;
    const existingUnlockedSpells = Array.isArray(existingData?.unlockedSpells)
      ? existingData.unlockedSpells.filter(
          (rewardId): rewardId is string => typeof rewardId === "string",
        )
      : [];
    const updatedProgress = buildExperienceAwardPreview(
      existingLevel,
      existingExperience,
      earnedXp.totalXp,
    );
    const newlyUnlockedRewardIds = getNewlyUnlockedRewardIds(
      existingLevel,
      updatedProgress.currentLevel,
    );
    const lastXpGainAnimation: UserProfileLastXpGainAnimation = {
      gameId,
      awardedXp: updatedProgress.awardedXp,
      fromLevel: existingLevel,
      fromExperience: existingExperience,
      toLevel: updatedProgress.currentLevel,
      toExperience: updatedProgress.xpGainedTowardCurrentLevel,
      playedAt: new Date().toISOString(),
    };

    transaction.set(
      userRef,
      {
        experience: updatedProgress.xpGainedTowardCurrentLevel,
        level: updatedProgress.currentLevel,
        unlockedSpells: Array.from(
          new Set([...existingUnlockedSpells, ...newlyUnlockedRewardIds]),
        ),
        lastFiveGames: clampLastFiveGames([
          ...existingLastFiveGames,
          playerPlacement + 1,
        ]),
        rewardedGameIds: [...rewardedGameIds, gameId],
        lastXpGainAnimation,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return {
      awardedXp: updatedProgress.awardedXp,
      previousLevel: updatedProgress.previousLevel,
      currentLevel: updatedProgress.currentLevel,
      xpGainedTowardCurrentLevel: updatedProgress.xpGainedTowardCurrentLevel,
      xpRequiredForCurrentLevel: updatedProgress.xpRequiredForCurrentLevel,
      xpRemainingToNextLevel: updatedProgress.xpRemainingToNextLevel,
      nextLevel: updatedProgress.nextLevel,
      leveledUp: updatedProgress.leveledUp,
      unlockedRewardLevels: updatedProgress.unlockedRewardLevels,
      showRewardPreview: updatedProgress.showRewardPreview,
    } satisfies LocalPlayerExperiencePreview;
  });
}

export default function GameScreen({ gameId }: GameScreenProps) {
  const router = useRouter();
  const drawTipMessage =
    "Click a card on your grid to either reveal or replace!";
  const discardTipMessage =
    "Select a card on your grid to swap with the discard pile.";
  const itemRevealTipMessage = "Select an unrevealed card to reveal.";
  const recoveryRevealTipMessage =
    "Select a card to reveal and finish your turn.";
  const firebaseReady = isFirebaseConfigured;
  const { uid, error: authError, isAnonymousUser } = useAnonymousAuth();
  const [game, setGame] = useState<GameMeta | null>(null);
  const [lobbyName, setLobbyName] = useState<string | null>(null);
  const [playerSummaries, setPlayerSummaries] = useState<GamePlayerSummary[]>(
    [],
  );
  const [localPlayerState, setLocalPlayerState] =
    useState<GamePlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionSyncError, setActionSyncError] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activeActionIndex, setActiveActionIndex] = useState<number | null>(
    null,
  );
  const [isStartingNextRound, setIsStartingNextRound] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isUxSettingsOpen, setIsUxSettingsOpen] = useState(true);
  const [isAccessibilitySettingsOpen, setIsAccessibilitySettingsOpen] =
    useState(true);
  const [isLeaveGameModalOpen, setIsLeaveGameModalOpen] = useState(false);
  const [isModeTooltipOpen, setIsModeTooltipOpen] = useState(false);
  const { preferences, setPreference } = usePreferences();
  const {
    firstTimeTips: showFirstTimeTips,
    darkMode: isDarkMode,
    cardSounds: isCardSoundsEnabled,
    backgroundMusic: isBackgroundMusicEnabled,
    snow: isSnowEnabled,
    autoFollow: autoFollowPreferenceEnabled,
  } = preferences;
  const [isAutoFollowEnabled, setIsAutoFollowEnabled] = useState(
    autoFollowPreferenceEnabled,
  );
  const [showDockedPiles, setShowDockedPiles] = useState(false);
  const [spectators, setSpectators] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const endingAnnouncementRef = useRef<string | null>(null);
  const gamePilesRef = useRef<HTMLDivElement | null>(null);
  const playerListContainerRef = useRef<HTMLDivElement | null>(null);
  const playerGridRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastAutoFollowInteractionAtRef = useRef(0);
  const autoFollowResumeTimerRef = useRef<number | null>(null);
  const autoFollowScrollTimerRef = useRef<number | null>(null);
  const autoFollowScrollIgnoreUntilRef = useRef(0);
  const lastAutoFollowAttemptKeyRef = useRef<string | null>(null);
  const [isAutoFollowSuspended, setIsAutoFollowSuspended] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isSpectatorModalOpen, setIsSpectatorModalOpen] = useState(false);
  const [isFinalTurnOverlayOpen, setIsFinalTurnOverlayOpen] = useState(false);
  const [
    dismissedFinalTurnForEndingPlayerId,
    setDismissedFinalTurnForEndingPlayerId,
  ] = useState<string | null>(null);
  const [isColdOverlayOpen, setIsColdOverlayOpen] = useState(false);
  const [dismissedColdOverlayRound, setDismissedColdOverlayRound] = useState<
    number | null
  >(null);
  const [isSpikedOverlayOpen, setIsSpikedOverlayOpen] = useState(false);
  const [dismissedSpikedOverlayRound, setDismissedSpikedOverlayRound] =
    useState<number | null>(null);
  const [isClearingOverlayOpen, setIsClearingOverlayOpen] = useState(false);
  const [dismissedClearingOverlayRound, setDismissedClearingOverlayRound] =
    useState<number | null>(null);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<
    LeaderboardEntry[]
  >([]);
  const leaderboardUpdateRef = useRef(new Set<string>());
  const userLastFiveGamesUpdateRef = useRef(new Set<string>());
  const [isFinalScoresOpen, setIsFinalScoresOpen] = useState(false);
  const [revealedBonusCount, setRevealedBonusCount] = useState(0);
  const hasGameCompletedRef = useRef(false);
  const localTurnTimeMsRef = useRef(0);
  const currentTurnStartedAtRef = useRef<number | null>(null);
  const submittedTurnTimeGamesRef = useRef(new Set<string>());
  const podiumLabels = ["1st", "2nd", "3rd"];
  const [itemTargets, setItemTargets] = useState<ItemTarget[]>([]);
  const [itemValue, setItemValue] = useState<number | null>(null);
  const [isSwapConfirmOpen, setIsSwapConfirmOpen] = useState(false);
  const [pendingItemReveal, setPendingItemReveal] = useState(false);
  const [selectedCardAnimationId, setSelectedCardAnimationId] = useState(0);
  const pendingDrawRef = useRef<Map<string, Card | null>>(new Map());
  const hasInitializedDrawSoundRef = useRef(false);
  const hasInitializedDiscardSelectSoundRef = useRef(false);
  const lastSelectedDiscardPlayerIdRef = useRef<string | null>(null);
  const lastTurnActionRef = useRef<string | null>(null);
  const lastClearSoundKeyRef = useRef<string | null>(null);
  const hasInitializedActionSoundRef = useRef(false);
  const hasInitializedClearSoundRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const betweenRoundsBufferRef = useRef<AudioBuffer | null>(null);
  const betweenRoundsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const betweenRoundsGainRef = useRef<GainNode | null>(null);
  const itemImpactSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const itemLoopSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeItemSoundRef = useRef<{
    playerId: string;
    itemCode: ItemCode;
  } | null>(null);
  const shouldPlayBetweenRoundsRef = useRef(false);
  const hasInitializedTurnSoundRef = useRef(false);
  const lastTurnSoundKeyRef = useRef<string | null>(null);
  const modeTooltipRef = useRef<HTMLDivElement | null>(null);
  const actionWatchdogTimerRef = useRef<number | null>(null);
  const hasStartedProgressivePreloadRef = useRef(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(true);
  const [localPlayerExperiencePreview, setLocalPlayerExperiencePreview] =
    useState<LocalPlayerExperiencePreview | null>(null);
  const players = useMemo<GamePlayer[]>(() => {
    return playerSummaries.map((player) => {
      const summaryState = {
        grid: player.publicGrid,
        revealed: player.revealed,
        pendingDraw: player.pendingDraw,
        pendingDrawSource: player.pendingDrawSource,
      };
      const isLocalPlayer = uid && player.id === uid;
      const isMisted = (player.mistTurnsRemaining ?? 0) > 0;
      const maskedGrid = Array.from({ length: 12 }, () => null);
      const maskedRevealed = Array.from({ length: 12 }, () => false);
      if (isLocalPlayer) {
        return { ...player, ...summaryState, ...(localPlayerState ?? {}) };
      }
      if (isMisted) {
        return {
          ...player,
          ...summaryState,
          grid: maskedGrid,
          revealed: maskedRevealed,
        };
      }
      return { ...player, ...summaryState };
    });
  }, [localPlayerState, playerSummaries, uid]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const handleResume = () => {
      audioContext.resume().catch(() => undefined);
    };

    window.addEventListener("click", handleResume, { once: true });
    window.addEventListener("keydown", handleResume, { once: true });
    window.addEventListener("touchstart", handleResume, { once: true });

    return () => {
      stopItemDrawAudio();
      audioBufferCacheRef.current.clear();
      audioContext.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const audioContext = audioContextRef.current;
    if (!audioContext) {
      return;
    }

    const gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
    betweenRoundsGainRef.current = gainNode;

    const handleResume = () => {
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => undefined);
      }
      if (shouldPlayBetweenRoundsRef.current) {
        void startBetweenRoundsAudio();
      }
    };

    window.addEventListener("click", handleResume);
    window.addEventListener("keydown", handleResume);
    window.addEventListener("touchstart", handleResume);

    return () => {
      window.removeEventListener("click", handleResume);
      window.removeEventListener("keydown", handleResume);
      window.removeEventListener("touchstart", handleResume);
      stopBetweenRoundsAudio();
      gainNode.disconnect();
      betweenRoundsGainRef.current = null;
      betweenRoundsBufferRef.current = null;
    };
  }, []);

  const getCardValueClass = (value: Card | null | undefined) => {
    if (typeof value !== "number") {
      return "";
    }
    if (value < 0) {
      return " card--value-negative";
    }
    if (value === 0) {
      return " card--value-zero";
    }
    if (value <= 3) {
      return " card--value-low";
    }
    if (value <= 6) {
      return " card--value-mid";
    }
    if (value <= 9) {
      return " card--value-high";
    }
    if (value <= 12) {
      return " card--value-max";
    }
    return " card--value-legend";
  };

  const isItemCard = (value: Card | null | undefined): value is ItemCard =>
    value != null && typeof value === "object" && value.kind === "item";

  const itemCardDetails: Record<
    ItemCode,
    { name: string; image: string; eyebrow: string }
  > = {
    C: { name: "Wild", image: "/cards/wild.png", eyebrow: "Wild" },
    E: { name: "Swap", image: "/cards/swap.png", eyebrow: "Swap" },
    F: { name: "Mist", image: "/cards/mist.png", eyebrow: "Mist" },
    G: { name: "Push", image: "/cards/push.png", eyebrow: "Push" },
    H: { name: "Mirror", image: "/cards/mirror.png", eyebrow: "Mirror" },
  };

  const getCardLabel = (value: Card | null | undefined) => {
    if (typeof value === "number") {
      return value;
    }
    if (isItemCard(value)) {
      return itemCardDetails[value.code]?.name ?? value.code;
    }
    return "—";
  };

  const renderItemContent = (code: ItemCode) => {
    const details = itemCardDetails[code];
    return (
      <span className="card__item-content">
        <span className="card__item-eyebrow">{details.eyebrow}</span>
        <img
          className="card__item-art"
          src={details.image}
          alt={`${details.name} item art`}
        />
      </span>
    );
  };

  const getCardStyleClass = (value: Card | null | undefined) => {
    if (isItemCard(value)) {
      return ` card--item card--item-${value.code}`;
    }
    return getCardValueClass(value);
  };

  const isCardTarget = (target: ItemSelectionTarget): target is ItemTarget =>
    "index" in target;

  const loadAudioBuffer = async (soundPath: string) => {
    const audioContext = audioContextRef.current;
    if (!audioContext) {
      return null;
    }

    const cached = audioBufferCacheRef.current.get(soundPath);
    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(soundPath);
      const buffer = await response.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(buffer);
      audioBufferCacheRef.current.set(soundPath, decoded);
      return decoded;
    } catch {
      return null;
    }
  };

  const preloadImageAsset = (path: string) =>
    new Promise<void>((resolve) => {
      if (typeof window === "undefined") {
        resolve();
        return;
      }
      const image = new window.Image();
      image.onload = () => resolve();
      image.onerror = () => resolve();
      image.src = path;
      if (image.complete) {
        resolve();
      }
    });

  const preloadAsset = async (
    path: string,
    type: "image" | "audio" | "fetch",
  ) => {
    if (type === "audio") {
      await loadAudioBuffer(path);
      return;
    }
    if (type === "image") {
      await preloadImageAsset(path);
      return;
    }
    await fetch(path).catch(() => undefined);
  };

  const preloadGroup = async (label: string) => {
    const group = PRELOAD_PRIORITY_GROUPS.find(
      (candidate) => candidate.label === label,
    );
    if (!group) {
      return;
    }

    const shouldSkipAudio =
      !isCardSoundsEnabled &&
      group.assets.some((asset) => asset.type === "audio");
    if (shouldSkipAudio) {
      return;
    }

    await Promise.allSettled(
      group.assets.map((asset) => preloadAsset(asset.path, asset.type)),
    );
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let isActive = true;
    const minimumOverlayDurationMs = 2000;
    let minimumOverlayTimer: number | null = null;
    const minimumDelayPromise = new Promise((resolve) => {
      minimumOverlayTimer = window.setTimeout(
        resolve,
        minimumOverlayDurationMs,
      );
    });

    const preloadCritical = Promise.all(
      CRITICAL_PRELOAD_GROUP_LABELS.map((label) => preloadGroup(label)),
    );

    Promise.allSettled([preloadCritical, minimumDelayPromise]).then(() => {
      if (isActive) {
        setShowLoadingOverlay(false);
      }
    });

    return () => {
      isActive = false;
      if (minimumOverlayTimer) {
        window.clearTimeout(minimumOverlayTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      hasStartedProgressivePreloadRef.current
    ) {
      return;
    }

    let idleTimer: number | null = null;
    let laterTimer: number | null = null;
    hasStartedProgressivePreloadRef.current = true;

    const warmNonCriticalAssets = () => {
      void preloadGroup("game-icons");
      void preloadGroup("item-artwork");
      idleTimer = window.setTimeout(() => {
        void preloadGroup("notification-sounds");
      }, 450);
      laterTimer = window.setTimeout(() => {
        void preloadGroup("everything-else");
      }, 1500);
    };

    const handleFirstInteraction = () => {
      warmNonCriticalAssets();
      window.removeEventListener("click", handleFirstInteraction);
      window.removeEventListener("keydown", handleFirstInteraction);
      window.removeEventListener("touchstart", handleFirstInteraction);
    };

    window.addEventListener("click", handleFirstInteraction, { once: true });
    window.addEventListener("keydown", handleFirstInteraction, { once: true });
    window.addEventListener("touchstart", handleFirstInteraction, {
      once: true,
    });

    return () => {
      window.removeEventListener("click", handleFirstInteraction);
      window.removeEventListener("keydown", handleFirstInteraction);
      window.removeEventListener("touchstart", handleFirstInteraction);
      if (idleTimer) {
        window.clearTimeout(idleTimer);
      }
      if (laterTimer) {
        window.clearTimeout(laterTimer);
      }
    };
  }, []);

  const playSound = (soundPath: string) => {
    if (!isCardSoundsEnabled) {
      return;
    }
    const audioContext = audioContextRef.current;
    if (!audioContext || typeof window === "undefined") {
      return;
    }

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => undefined);
    }

    loadAudioBuffer(soundPath).then((buffer) => {
      if (!buffer || audioContextRef.current !== audioContext) {
        return;
      }
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(0);
    });
  };

  const startBetweenRoundsAudio = async () => {
    const audioContext = audioContextRef.current;
    const gainNode = betweenRoundsGainRef.current;
    if (!audioContext || !gainNode || betweenRoundsSourceRef.current) {
      return;
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => undefined);
    }

    let buffer = betweenRoundsBufferRef.current;
    if (!buffer) {
      buffer = await loadAudioBuffer("/sounds/theme/theme-reprised-quiet.wav");
      if (!buffer) {
        return;
      }
      betweenRoundsBufferRef.current = buffer;
    }

    if (audioContextRef.current !== audioContext) {
      return;
    }

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gainNode);
    source.onended = () => {
      if (betweenRoundsSourceRef.current === source) {
        betweenRoundsSourceRef.current = null;
      }
    };
    const now = audioContext.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(
      BETWEEN_ROUNDS_TARGET_VOLUME,
      now + BETWEEN_ROUNDS_FADE_IN_SECONDS,
    );
    source.start(0);
    betweenRoundsSourceRef.current = source;
  };

  const stopBetweenRoundsAudio = () => {
    const source = betweenRoundsSourceRef.current;
    if (!source) {
      return;
    }
    source.stop();
    source.disconnect();
    betweenRoundsSourceRef.current = null;
  };

  const stopItemDrawAudio = () => {
    if (itemImpactSourceRef.current) {
      itemImpactSourceRef.current.stop();
      itemImpactSourceRef.current.disconnect();
      itemImpactSourceRef.current = null;
    }
    if (itemLoopSourceRef.current) {
      itemLoopSourceRef.current.stop();
      itemLoopSourceRef.current.disconnect();
      itemLoopSourceRef.current = null;
    }
  };

  const getItemDrawSoundPaths = (code: ItemCode) => {
    const itemNameByCode: Record<ItemCode, string> = {
      C: "WILD",
      E: "SWAP",
      F: "MIST",
      G: "PUSH",
      H: "MIRROR",
    };
    const itemFolderByCode: Record<ItemCode, string> = {
      C: "WILD",
      E: "SWAP",
      F: "MIST",
      G: "PUSH",
      H: "MIRROR",
    };
    const itemName = itemNameByCode[code];
    const folder = itemFolderByCode[code];
    return {
      impact: `/sounds/card-draw/items/${folder}/${itemName}-Impact.wav`,
      loop: `/sounds/card-draw/items/${folder}/${itemName}-Loop.wav`,
      finish: `/sounds/card-draw/items/${folder}/${itemName}-Finish.wav`,
    };
  };

  const playItemDrawSoundSequence = async (
    playerId: string,
    code: ItemCode,
  ) => {
    if (!isCardSoundsEnabled) {
      return;
    }

    const audioContext = audioContextRef.current;
    if (!audioContext || typeof window === "undefined") {
      return;
    }

    const { impact, loop } = getItemDrawSoundPaths(code);
    const [impactBuffer, loopBuffer] = await Promise.all([
      loadAudioBuffer(impact),
      loadAudioBuffer(loop),
    ]);

    if (
      !impactBuffer ||
      !loopBuffer ||
      audioContextRef.current !== audioContext
    ) {
      return;
    }

    stopItemDrawAudio();

    const state = { playerId, itemCode: code };
    activeItemSoundRef.current = state;

    const impactSource = audioContext.createBufferSource();
    impactSource.buffer = impactBuffer;
    impactSource.connect(audioContext.destination);
    impactSource.onended = () => {
      if (itemImpactSourceRef.current === impactSource) {
        itemImpactSourceRef.current = null;
      }
      if (activeItemSoundRef.current !== state || itemLoopSourceRef.current) {
        return;
      }
      const loopSource = audioContext.createBufferSource();
      loopSource.buffer = loopBuffer;
      loopSource.loop = true;
      loopSource.connect(audioContext.destination);
      loopSource.onended = () => {
        if (itemLoopSourceRef.current === loopSource) {
          itemLoopSourceRef.current = null;
        }
      };
      loopSource.start(0);
      itemLoopSourceRef.current = loopSource;
    };
    impactSource.start(0);
    itemImpactSourceRef.current = impactSource;
  };

  const playItemDrawFinishSound = (code: ItemCode) => {
    const { finish } = getItemDrawSoundPaths(code);
    playSound(finish);
  };

  const getDrawSoundPath = (value: Card) => {
    if (isItemCard(value)) {
      return null;
    }

    if (value === -1) {
      return "/sounds/card-draw/minus-one.wav";
    }
    if (value === -2) {
      return "/sounds/card-draw/minus-two.wav";
    }
    if (value === 0) {
      return "/sounds/card-draw/zero.wav";
    }
    if (value >= 1 && value <= 9) {
      return "/sounds/card-draw/one-nine.wav";
    }
    if (value === 10 || value === 11) {
      return "/sounds/card-draw/ten-eleven.wav";
    }
    if (value === 12) {
      return "/sounds/card-draw/twelve.wav";
    }
    if (value === 13) {
      return "/sounds/card-draw/thirteen.wav";
    }
    return null;
  };

  const playDrawSound = (value: Card) => {
    if (isItemCard(value)) {
      return;
    }

    const soundPath = getDrawSoundPath(value);
    if (!soundPath || typeof window === "undefined") {
      return;
    }
    playSound(soundPath);
  };

  const areCardsEqual = (
    first: Card | null | undefined,
    second: Card | null | undefined,
  ) => {
    if (first == null || second == null) {
      return first === second;
    }
    if (typeof first === "number" || typeof second === "number") {
      return first === second;
    }
    return first.kind === second.kind && first.code === second.code;
  };

  const playRevealTradeSound = () => {
    if (typeof window === "undefined") {
      return;
    }
    playSound("/sounds/card-draw/reveal-trade.wav");
  };

  const shouldPlayRevealTradeSound = (action: string | null | undefined) => {
    if (!action) {
      return false;
    }
    const normalized = action.toLowerCase();
    return normalized.includes("reveal") || normalized.includes("swap");
  };

  useEffect(() => {
    if (!firebaseReady || !gameId) {
      return;
    }

    const gameRef = doc(db, "games", gameId);
    const unsubscribe = onSnapshot(
      gameRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setGame(null);
          return;
        }
        const data = snapshot.data();
        setGame({
          status: (data.status as string | undefined) ?? "pending",
          lobbyId: (data.lobbyId as string | null | undefined) ?? null,
          currentPlayerId: (data.currentPlayerId as string | undefined) ?? null,
          activePlayerOrder: Array.isArray(data.activePlayerOrder)
            ? (data.activePlayerOrder as string[])
            : [],
          deck: Array.isArray(data.deck) ? (data.deck as Card[]) : [],
          discard: Array.isArray(data.discard) ? (data.discard as Card[]) : [],
          hostId: (data.hostId as string | null | undefined) ?? null,
          roundNumber: (data.roundNumber as number | undefined) ?? 1,
          turnPhase: (data.turnPhase as string | undefined) ?? "choose-draw",
          spikeMode: Boolean(data.spikeMode),
          spikeItemCount:
            (data.spikeItemCount as SpikeItemCount | undefined) ?? "low",
          spikeRowClear: Boolean(data.spikeRowClear),
          spikeEndGameBonuses:
            (data.spikeEndGameBonuses as boolean | undefined) ?? true,
          targetScore: (data.targetScore as 50 | 100 | undefined) ?? 100,
          endingPlayerId:
            (data.endingPlayerId as string | null | undefined) ?? null,
          finalTurnRemainingIds: Array.isArray(data.finalTurnRemainingIds)
            ? (data.finalTurnRemainingIds as string[])
            : null,
          selectedDiscardPlayerId:
            (data.selectedDiscardPlayerId as string | null | undefined) ?? null,
          roundScores:
            (data.roundScores as Record<string, number> | undefined) ??
            undefined,
          roundClearingPlayerIds:
            (data.roundClearingPlayerIds as string[] | undefined) ?? undefined,
          lastTurnPlayerId:
            (data.lastTurnPlayerId as string | null | undefined) ?? null,
          lastTurnAction:
            (data.lastTurnAction as string | null | undefined) ?? null,
          lastTurnActionAt:
            (data.lastTurnActionAt as Timestamp | null | undefined) ?? null,
          lastClearType:
            (data.lastClearType as
              | "row"
              | "column"
              | "row-column"
              | null
              | undefined) ?? null,
          lastClearTypeAt:
            (data.lastClearTypeAt as Timestamp | null | undefined) ?? null,
          endGameBonusResults:
            (data.endGameBonusResults as
              | {
                  mostRowsClearedWinnerId?: string | null;
                  lowestDiscardedWinnerId?: string | null;
                  fastestPlayerWinnerId?: string | null;
                }
              | null
              | undefined) ?? null,
          turnTimeSubmissionsMs:
            (data.turnTimeSubmissionsMs as
              | Record<string, number>
              | undefined) ?? undefined,
        });
      },
      (err) => {
        setError(err.message);
      },
    );

    return () => unsubscribe();
  }, [firebaseReady, gameId]);

  useEffect(() => {
    if (!firebaseReady || !game?.lobbyId) {
      setLobbyName(null);
      return;
    }

    const lobbyRef = doc(db, "lobbies", game.lobbyId);
    const unsubscribe = onSnapshot(
      lobbyRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setLobbyName("Unknown lobby");
          return;
        }
        const data = snapshot.data();
        setLobbyName((data.name as string | undefined) ?? "Untitled lobby");
      },
      (err) => {
        setError(err.message);
      },
    );

    return () => unsubscribe();
  }, [firebaseReady, game?.lobbyId]);

  useEffect(() => {
    if (!firebaseReady || !players.length) {
      return;
    }

    const previousPendingDraws = pendingDrawRef.current;
    const nextPendingDraws = new Map<string, Card | null>();

    players.forEach((player) => {
      const nextPending = player.pendingDraw ?? null;
      nextPendingDraws.set(player.id, nextPending);
      const previousPending = previousPendingDraws.get(player.id);

      if (
        hasInitializedDrawSoundRef.current &&
        player.pendingDrawSource === "deck" &&
        nextPending != null &&
        !areCardsEqual(nextPending, previousPending)
      ) {
        if (isItemCard(nextPending)) {
          void playItemDrawSoundSequence(player.id, nextPending.code);
        } else {
          playDrawSound(nextPending);
        }
      }
    });

    pendingDrawRef.current = nextPendingDraws;
    if (!hasInitializedDrawSoundRef.current) {
      hasInitializedDrawSoundRef.current = true;
    }
  }, [firebaseReady, players]);

  useEffect(() => {
    if (!firebaseReady) {
      return;
    }

    if (!isCardSoundsEnabled) {
      activeItemSoundRef.current = null;
      stopItemDrawAudio();
      return;
    }

    const activeItemSound = activeItemSoundRef.current;
    if (!activeItemSound) {
      return;
    }

    if (game?.currentPlayerId === activeItemSound.playerId) {
      return;
    }

    stopItemDrawAudio();
    playItemDrawFinishSound(activeItemSound.itemCode);
    activeItemSoundRef.current = null;
  }, [firebaseReady, game?.currentPlayerId, isCardSoundsEnabled]);

  useEffect(() => {
    if (!firebaseReady) {
      return;
    }

    const currentSelectedDiscardPlayerId =
      game?.selectedDiscardPlayerId ?? null;
    const previousSelectedDiscardPlayerId =
      lastSelectedDiscardPlayerIdRef.current;
    const hasTopDiscard = (game?.discard?.length ?? 0) > 0;

    if (!hasInitializedDiscardSelectSoundRef.current) {
      hasInitializedDiscardSelectSoundRef.current = true;
      lastSelectedDiscardPlayerIdRef.current = currentSelectedDiscardPlayerId;
      return;
    }

    if (
      currentSelectedDiscardPlayerId &&
      currentSelectedDiscardPlayerId !== previousSelectedDiscardPlayerId &&
      hasTopDiscard
    ) {
      playSound("/sounds/card-draw/discard-to-select.wav");
    }

    lastSelectedDiscardPlayerIdRef.current = currentSelectedDiscardPlayerId;
  }, [firebaseReady, game?.discard, game?.selectedDiscardPlayerId]);

  useEffect(() => {
    if (!firebaseReady || !game) {
      return;
    }

    const action = game.lastTurnAction ?? null;
    const actionKey = String(
      game.lastTurnActionAt?.toMillis?.() ??
        `${game.lastTurnPlayerId ?? "none"}:${action ?? "none"}`,
    );
    if (!hasInitializedActionSoundRef.current) {
      hasInitializedActionSoundRef.current = true;
      lastTurnActionRef.current = actionKey;
      return;
    }

    if (
      action &&
      actionKey !== lastTurnActionRef.current &&
      shouldPlayRevealTradeSound(action)
    ) {
      playRevealTradeSound();
    }

    lastTurnActionRef.current = actionKey;
  }, [firebaseReady, game]);

  useEffect(() => {
    if (!firebaseReady || !game) {
      return;
    }

    const clearType = game.lastClearType ?? null;
    const clearKey = String(
      game.lastClearTypeAt?.toMillis?.() ??
        `${game.lastTurnPlayerId ?? "none"}:${clearType ?? "none"}`,
    );

    if (!hasInitializedClearSoundRef.current) {
      hasInitializedClearSoundRef.current = true;
      lastClearSoundKeyRef.current = clearKey;
      return;
    }

    if (clearType && clearKey !== lastClearSoundKeyRef.current) {
      if (clearType === "row") {
        playSound("/sounds/notifications/clear-row.wav");
      } else if (clearType === "column") {
        playSound("/sounds/notifications/clear-column.wav");
      } else {
        playSound("/sounds/notifications/clear-row.wav");
        playSound("/sounds/notifications/clear-column.wav");
      }
    }

    lastClearSoundKeyRef.current = clearKey;
  }, [firebaseReady, game]);

  useEffect(() => {
    if (!firebaseReady || !isLeaderboardOpen) {
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
          ).catch((err: Error) => setError(err.message));
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
      },
      (err) => {
        setError(err.message);
      },
    );

    return () => unsubscribe();
  }, [firebaseReady, isLeaderboardOpen]);

  useEffect(() => {
    if (!firebaseReady || !gameId) {
      return;
    }

    const playerCollection = collection(db, "games", gameId, "players");
    const unsubscribe = onSnapshot(
      playerCollection,
      (snapshot) => {
        const nextPlayers = snapshot.docs.map((playerDoc) => {
          const data = playerDoc.data();
          return {
            id: playerDoc.id,
            displayName:
              (data.displayName as string | undefined) ?? "Anonymous player",
            isReady: Boolean(data.isReady),
            totalScore: (data.totalScore as number | undefined) ?? undefined,
            revealedCount:
              (data.revealedCount as number | undefined) ?? undefined,
            mistTurnsRemaining:
              (data.mistTurnsRemaining as number | null | undefined) ?? null,
            sprintTurnsRemaining:
              (data.sprintTurnsRemaining as number | null | undefined) ?? null,
            publicGrid: Array.isArray(data.publicGrid)
              ? (data.publicGrid as Array<Card | null>)
              : undefined,
            revealed: Array.isArray(data.revealed)
              ? (data.revealed as boolean[])
              : undefined,
            pendingDraw: (data.pendingDraw as Card | null | undefined) ?? null,
            pendingDrawSource:
              (data.pendingDrawSource as
                | "deck"
                | "discard"
                | null
                | undefined) ?? null,
            pointsClearedFromRows:
              (data.pointsClearedFromRows as number | undefined) ?? 0,
            pointsDiscarded: (data.pointsDiscarded as number | undefined) ?? 0,
            discardedCardCount:
              (data.discardedCardCount as number | undefined) ?? 0,
            revealedCardValueTotal:
              (data.revealedCardValueTotal as number | undefined) ?? 0,
            revealedCardCount:
              (data.revealedCardCount as number | undefined) ?? 0,
            itemCardsDrawn: (data.itemCardsDrawn as number | undefined) ?? 0,
            roundSpiked: Boolean(data.roundSpiked),
          };
        });
        setPlayerSummaries(nextPlayers);
      },
      (err) => {
        setError(err.message);
      },
    );

    return () => unsubscribe();
  }, [firebaseReady, gameId]);

  useEffect(() => {
    if (!firebaseReady || !gameId || !uid) {
      setLocalPlayerState(null);
      return;
    }

    const playerStateRef = doc(db, "games", gameId, "playerStates", uid);
    const unsubscribe = onSnapshot(
      playerStateRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setLocalPlayerState(null);
          return;
        }
        const data = snapshot.data();
        setLocalPlayerState({
          grid: Array.isArray(data.grid)
            ? (data.grid as Array<Card | null>)
            : undefined,
          revealed: Array.isArray(data.revealed)
            ? (data.revealed as boolean[])
            : undefined,
          pendingDraw: (data.pendingDraw as Card | null | undefined) ?? null,
          pendingDrawSource:
            (data.pendingDrawSource as "deck" | "discard" | null | undefined) ??
            null,
          sprintTurnsRemaining:
            (data.sprintTurnsRemaining as number | null | undefined) ?? null,
        });
      },
      (err) => {
        setError(err.message);
      },
    );

    return () => unsubscribe();
  }, [firebaseReady, gameId, uid]);

  useEffect(() => {
    if (!firebaseReady || !gameId) {
      return;
    }

    const spectatorCollection = collection(db, "games", gameId, "spectators");
    const unsubscribe = onSnapshot(
      spectatorCollection,
      (snapshot) => {
        setSpectators(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            displayName:
              (doc.data().displayName as string | undefined) ??
              "Anonymous spectator",
          })),
        );
      },
      (err) => {
        setError(err.message);
      },
    );

    return () => unsubscribe();
  }, [firebaseReady, gameId]);

  useEffect(() => {
    if (authError) {
      setError(authError);
    }
  }, [authError]);

  const orderedPlayers = useMemo(() => {
    if (!game?.activePlayerOrder.length) {
      return players;
    }
    const playerMap = new Map(players.map((player) => [player.id, player]));
    const ordered = game.activePlayerOrder
      .map((playerId) => playerMap.get(playerId))
      .filter((player): player is GamePlayer => Boolean(player));
    const remaining = players.filter(
      (player) => !game.activePlayerOrder.includes(player.id),
    );
    return [...ordered, ...remaining];
  }, [game?.activePlayerOrder, players]);

  const getItemTargetLabel = (target: ItemSelectionTarget) => {
    const targetPlayer = orderedPlayers.find(
      (player) => player.id === target.playerId,
    );
    const isTargetCardRevealed = Boolean(
      targetPlayer?.revealed?.[target.index],
    );
    const targetCard =
      targetPlayer?.grid?.[target.index] ??
      targetPlayer?.publicGrid?.[target.index] ??
      null;

    if (
      isTargetCardRevealed &&
      targetCard !== null &&
      targetCard !== undefined
    ) {
      return getCardLabel(targetCard);
    }

    return (
      <img
        className="item-panel__target-question"
        src="/question-mark-icon.png"
        alt="Hidden card"
      />
    );
  };

  const displayPlayers = useMemo(() => {
    if (!uid) {
      return orderedPlayers;
    }
    const localPlayerIndex = orderedPlayers.findIndex(
      (player) => player.id === uid,
    );
    if (localPlayerIndex === -1) {
      return orderedPlayers;
    }
    return [
      ...orderedPlayers.slice(localPlayerIndex),
      ...orderedPlayers.slice(0, localPlayerIndex),
    ];
  }, [orderedPlayers, uid]);

  const currentPlayer = useMemo(
    () =>
      game?.currentPlayerId
        ? (orderedPlayers.find(
            (player) => player.id === game.currentPlayerId,
          ) ?? null)
        : null,
    [game?.currentPlayerId, orderedPlayers],
  );
  const shouldShowAutoFollowWidget = Boolean(
    uid &&
    game?.status === "playing" &&
    game?.currentPlayerId &&
    autoFollowPreferenceEnabled,
  );
  const isAutoFollowActive =
    shouldShowAutoFollowWidget && isAutoFollowEnabled && !isAutoFollowSuspended;

  useEffect(() => {
    setIsAutoFollowEnabled(autoFollowPreferenceEnabled);
  }, [autoFollowPreferenceEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateReducedMotionPreference = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    updateReducedMotionPreference();
    mediaQuery.addEventListener("change", updateReducedMotionPreference);

    return () => {
      mediaQuery.removeEventListener("change", updateReducedMotionPreference);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !shouldShowAutoFollowWidget) {
      setIsAutoFollowSuspended(false);
      if (autoFollowResumeTimerRef.current !== null) {
        window.clearTimeout(autoFollowResumeTimerRef.current);
        autoFollowResumeTimerRef.current = null;
      }
      return;
    }

    const handleInteraction = () => {
      if (Date.now() < autoFollowScrollIgnoreUntilRef.current) {
        return;
      }

      lastAutoFollowInteractionAtRef.current = Date.now();
      setIsAutoFollowSuspended(true);

      if (autoFollowResumeTimerRef.current !== null) {
        window.clearTimeout(autoFollowResumeTimerRef.current);
      }

      autoFollowResumeTimerRef.current = window.setTimeout(() => {
        if (Date.now() - lastAutoFollowInteractionAtRef.current >= 1600) {
          setIsAutoFollowSuspended(false);
        }
        autoFollowResumeTimerRef.current = null;
      }, 1600);
    };

    const playerListContainer = playerListContainerRef.current;
    const interactionEvents: Array<keyof WindowEventMap> = [
      "wheel",
      "touchmove",
    ];
    const keyboardHandler = (event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
          "Tab",
        ].includes(event.key)
      ) {
        handleInteraction();
      }
    };

    window.addEventListener("scroll", handleInteraction, { passive: true });
    window.addEventListener("keydown", keyboardHandler, { passive: true });
    interactionEvents.forEach((eventName) => {
      window.addEventListener(eventName, handleInteraction, { passive: true });
      playerListContainer?.addEventListener(eventName, handleInteraction, {
        passive: true,
      });
    });
    playerListContainer?.addEventListener("scroll", handleInteraction, {
      passive: true,
    });

    return () => {
      window.removeEventListener("scroll", handleInteraction);
      window.removeEventListener("keydown", keyboardHandler);
      interactionEvents.forEach((eventName) => {
        window.removeEventListener(eventName, handleInteraction);
        playerListContainer?.removeEventListener(eventName, handleInteraction);
      });
      playerListContainer?.removeEventListener("scroll", handleInteraction);
      if (autoFollowResumeTimerRef.current !== null) {
        window.clearTimeout(autoFollowResumeTimerRef.current);
        autoFollowResumeTimerRef.current = null;
      }
    };
  }, [shouldShowAutoFollowWidget]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !isAutoFollowActive ||
      !uid ||
      !game?.currentPlayerId
    ) {
      lastAutoFollowAttemptKeyRef.current = null;
      if (autoFollowScrollTimerRef.current !== null) {
        window.clearTimeout(autoFollowScrollTimerRef.current);
        autoFollowScrollTimerRef.current = null;
      }
      return;
    }

    const autoFollowTargetPlayerId =
      game.currentPlayerId === uid ? uid : game.currentPlayerId;
    const activePlayerElement =
      playerGridRefs.current[autoFollowTargetPlayerId];
    if (!activePlayerElement) {
      return;
    }

    const viewportMargin = 32;
    const activePlayerRect = activePlayerElement.getBoundingClientRect();
    const containerRect =
      playerListContainerRef.current?.getBoundingClientRect() ?? null;
    const visibleTop = containerRect
      ? Math.max(containerRect.top, viewportMargin)
      : viewportMargin;
    const visibleBottom = containerRect
      ? Math.min(containerRect.bottom, window.innerHeight - viewportMargin)
      : window.innerHeight - viewportMargin;
    const isAdequatelyVisible =
      activePlayerRect.top >= visibleTop &&
      activePlayerRect.bottom <= visibleBottom;
    const autoFollowAttemptKey = `${autoFollowTargetPlayerId}:${isAutoFollowActive}`;

    if (isAdequatelyVisible) {
      lastAutoFollowAttemptKeyRef.current = autoFollowAttemptKey;
      return;
    }

    if (lastAutoFollowAttemptKeyRef.current === autoFollowAttemptKey) {
      return;
    }

    if (autoFollowScrollTimerRef.current !== null) {
      window.clearTimeout(autoFollowScrollTimerRef.current);
    }

    autoFollowScrollTimerRef.current = window.setTimeout(() => {
      autoFollowScrollIgnoreUntilRef.current =
        Date.now() + (prefersReducedMotion ? 200 : 900);
      activePlayerElement.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: prefersReducedMotion ? "nearest" : "center",
        inline: "nearest",
      });
      lastAutoFollowAttemptKeyRef.current = autoFollowAttemptKey;
      autoFollowScrollTimerRef.current = null;
    }, 120);

    return () => {
      if (autoFollowScrollTimerRef.current !== null) {
        window.clearTimeout(autoFollowScrollTimerRef.current);
        autoFollowScrollTimerRef.current = null;
      }
    };
  }, [
    displayPlayers,
    game?.currentPlayerId,
    isAutoFollowActive,
    prefersReducedMotion,
    uid,
  ]);

  const lastTurnSummary = useMemo(() => {
    if (!game || !game.lastTurnPlayerId || !game.lastTurnAction) {
      return "First turn of the game";
    }
    const lastPlayer = orderedPlayers.find(
      (player) => player.id === game.lastTurnPlayerId,
    );
    const lastPlayerName = lastPlayer?.displayName ?? "Previous player";
    return `${lastPlayerName} ${game.lastTurnAction}`;
  }, [game, orderedPlayers]);

  const sortedScores = useMemo(() => {
    if (game?.status !== "round-complete") {
      return [];
    }
    return [...orderedPlayers]
      .map((player) => ({
        id: player.id,
        displayName: player.displayName,
        roundScore: game.roundScores?.[player.id] ?? 0,
        totalScore: player.totalScore ?? 0,
        isReady: player.isReady,
        roundSpiked: Boolean(player.roundSpiked),
      }))
      .sort((a, b) => a.roundScore - b.roundScore);
  }, [game?.roundScores, game?.status, orderedPlayers]);
  const gameIdHash = useMemo(
    () =>
      Array.from(gameId).reduce((hash, char, index) => {
        return hash + char.charCodeAt(0) * (index + 1);
      }, 0),
    [gameId],
  );
  const getDiscardTransformStyle = (
    discardIndex: number,
    discardCount: number,
    seed: number,
  ): CSSProperties => {
    if (discardCount <= 0 || discardIndex < 0 || discardIndex >= discardCount) {
      return {};
    }
    const depthFromTop = discardCount - 1 - discardIndex;
    const visibleDepth = Math.min(depthFromTop, 5);
    const index = discardIndex;
    const fract = (value: number) => value - Math.floor(value);
    const lerp = (min: number, max: number, t: number) => min + (max - min) * t;
    const u = fract(Math.sin(index * 12.9898 + seed) * 43758.5453);
    const rotateDeg = lerp(-6, 6, u);
    const skewDeg = lerp(-2, 2, fract(u * 97.13));
    const offsetX = lerp(-1.5, 1.5, fract(u * 53.7));
    const offsetY = lerp(-1, 1, fract(u * 29.41));
    const stackOffsetX = visibleDepth * -1.2;
    const stackOffsetY = visibleDepth * -1.1;

    return {
      "--discard-stack-offset-x": `${stackOffsetX.toFixed(3)}px`,
      "--discard-stack-offset-y": `${stackOffsetY.toFixed(3)}px`,
      "--discard-rotate": `${rotateDeg.toFixed(3)}deg`,
      "--discard-skew": `${skewDeg.toFixed(3)}deg`,
      "--discard-offset-x": `${offsetX.toFixed(3)}px`,
      "--discard-offset-y": `${offsetY.toFixed(3)}px`,
      zIndex: discardIndex + 1,
    } as CSSProperties;
  };
  const topDiscard =
    game?.discard && game.discard.length > 0
      ? game.discard[game.discard.length - 1]
      : null;
  const hasCardValue = (value: Card | null | undefined): value is Card =>
    value !== null && value !== undefined;
  const hasDiscard = hasCardValue(topDiscard);
  const discardTransformSeed = useMemo(
    () => gameIdHash * 0.013 + (game?.roundNumber ?? 0) * 0.73,
    [game?.roundNumber, gameIdHash],
  );
  const drawTransformSeed = useMemo(
    () => gameIdHash * 0.021 + (game?.roundNumber ?? 0) * 0.41,
    [game?.roundNumber, gameIdHash],
  );
  const discardStackCards = useMemo(() => {
    const discardPile = game?.discard ?? [];
    const maxVisibleStackCards = 6;
    const startIndex = Math.max(0, discardPile.length - maxVisibleStackCards);

    return discardPile.slice(startIndex).map((card, localIndex) => {
      const discardIndex = startIndex + localIndex;
      return {
        card,
        discardIndex,
        isTopCard: discardIndex === discardPile.length - 1,
        style: getDiscardTransformStyle(
          discardIndex,
          discardPile.length,
          discardTransformSeed,
        ),
      };
    });
  }, [discardTransformSeed, game?.discard]);

  const getDrawTransformStyle = (
    drawIndex: number,
    drawCount: number,
    seed: number,
  ): CSSProperties => {
    if (drawCount <= 0 || drawIndex < 0 || drawIndex >= drawCount) {
      return {};
    }

    const depthFromTop = drawCount - 1 - drawIndex;
    const visibleDepth = Math.min(depthFromTop, 5);
    const index = drawIndex;
    const fract = (value: number) => value - Math.floor(value);
    const lerp = (min: number, max: number, t: number) => min + (max - min) * t;
    const u = fract(Math.sin(index * 15.734 + seed) * 24693.1719);
    const rotateDeg = lerp(-4.5, 4.5, u);
    const skewDeg = lerp(-1.7, 1.7, fract(u * 89.17));
    const offsetX = lerp(-1.3, 1.3, fract(u * 41.3));
    const offsetY = lerp(-0.8, 0.8, fract(u * 23.17));
    const stackOffsetX = visibleDepth * -1.15;
    const stackOffsetY = visibleDepth * -1.05;

    return {
      "--draw-stack-offset-x": `${stackOffsetX.toFixed(3)}px`,
      "--draw-stack-offset-y": `${stackOffsetY.toFixed(3)}px`,
      "--draw-rotate": `${rotateDeg.toFixed(3)}deg`,
      "--draw-skew": `${skewDeg.toFixed(3)}deg`,
      "--draw-offset-x": `${offsetX.toFixed(3)}px`,
      "--draw-offset-y": `${offsetY.toFixed(3)}px`,
      zIndex: drawIndex + 1,
    } as CSSProperties;
  };

  const drawStackCards = useMemo(() => {
    const drawPile = game?.deck ?? [];
    const maxVisibleStackCards = 6;
    const startIndex = Math.max(0, drawPile.length - maxVisibleStackCards);

    return drawPile.slice(startIndex).map((_, localIndex) => {
      const drawIndex = startIndex + localIndex;
      return {
        drawIndex,
        isTopCard: drawIndex === drawPile.length - 1,
        style: getDrawTransformStyle(
          drawIndex,
          drawPile.length,
          drawTransformSeed,
        ),
      };
    });
  }, [drawTransformSeed, game?.deck]);

  const renderDrawPile = () => {
    if ((game?.deck.length ?? 0) <= 0) {
      return (
        <div className="card card--discard" aria-label="Empty draw pile">
          —
        </div>
      );
    }

    return (
      <div className="draw-stack">
        {drawStackCards.map(({ drawIndex, isTopCard, style }) =>
          isTopCard ? (
            <button
              key={`draw-top-${drawIndex}`}
              type="button"
              className="card-back-button card-back-button--stack card-back-button--top"
              aria-label="Draw pile (face down)"
              onClick={handleDrawFromDeck}
              disabled={!canDrawFromDeck}
              style={style}
            >
              <span className="card-back-image" aria-hidden="true" />
            </button>
          ) : (
            <div
              key={`draw-${drawIndex}`}
              className="card-back-button card-back-button--stack"
              style={style}
            >
              <span className="card-back-image" aria-hidden="true" />
            </div>
          ),
        )}
      </div>
    );
  };

  const renderDiscardPile = () => {
    if (!hasDiscard) {
      return (
        <div className="card card--discard" aria-label="Empty discard pile">
          —
        </div>
      );
    }

    return (
      <div className="discard-stack">
        {discardStackCards.map(({ card, discardIndex, isTopCard, style }) =>
          isTopCard ? (
            <button
              key={`discard-top-${discardIndex}`}
              type="button"
              className={`card card--discard-pile card--discard-pile-stack card--discard-top${getCardStyleClass(card)}`}
              aria-label="Discard pile"
              onClick={handleSelectDiscard}
              disabled={!canSelectDiscardTarget}
              style={style}
            >
              {isItemCard(card) ? (
                renderItemContent(card.code)
              ) : (
                <span className="card__value">{getCardLabel(card)}</span>
              )}
            </button>
          ) : (
            <div
              key={`discard-${discardIndex}`}
              className={`card card--discard-pile card--discard-pile-stack card--discard-under${getCardStyleClass(card)}`}
              style={style}
            >
              {isItemCard(card) ? (
                renderItemContent(card.code)
              ) : (
                <span className="card__value">{getCardLabel(card)}</span>
              )}
            </div>
          ),
        )}
      </div>
    );
  };
  const isCurrentTurn = Boolean(
    uid && game?.currentPlayerId && uid === game.currentPlayerId,
  );
  const isSprinting = Boolean(
    isCurrentTurn && (currentPlayer?.sprintTurnsRemaining ?? 0) > 0,
  );
  const isHost = Boolean(uid && game?.hostId && uid === game.hostId);
  const isRoundComplete = game?.status === "round-complete";
  const isGameComplete = game?.status === "game-complete";
  const isGameActive = game?.status === "playing";

  const shouldPlayBetweenRounds = isRoundComplete || isGameComplete;
  const lobbyLabel = lobbyName ? `${lobbyName}` : "Lobby Name Loading...";
  const modeLabel = useMemo(() => {
    if (!game) {
      return "Mode Loading...";
    }
    return `${getModeLabel(game.spikeMode)}`;
  }, [game]);
  const modeLabelTitle = useMemo(() => {
    if (!game) {
      return "Loading mode details.";
    }
    return getModeDetails(
      game.spikeMode,
      game.spikeItemCount,
      game.spikeRowClear,
      game.spikeEndGameBonuses,
      game.targetScore,
    );
  }, [game]);
  const isLocalPlayer = Boolean(
    uid && players.some((player) => player.id === uid),
  );

  useEffect(() => {
    localTurnTimeMsRef.current = 0;
    currentTurnStartedAtRef.current = null;
  }, [gameId]);

  useEffect(() => {
    const shouldTrackCurrentTurn = Boolean(
      uid && isCurrentTurn && isGameActive,
    );

    if (shouldTrackCurrentTurn) {
      if (currentTurnStartedAtRef.current === null) {
        currentTurnStartedAtRef.current = Date.now();
      }
      return;
    }

    if (currentTurnStartedAtRef.current !== null) {
      localTurnTimeMsRef.current += Math.max(
        0,
        Date.now() - currentTurnStartedAtRef.current,
      );
      currentTurnStartedAtRef.current = null;
    }
  }, [isCurrentTurn, isGameActive, uid]);

  useEffect(() => {
    if (!firebaseReady || !uid || !isLocalPlayer || !game || !isGameComplete) {
      return;
    }

    if (submittedTurnTimeGamesRef.current.has(gameId)) {
      return;
    }

    if (typeof game.turnTimeSubmissionsMs?.[uid] === "number") {
      submittedTurnTimeGamesRef.current.add(gameId);
      return;
    }

    const inProgressTurnMs =
      currentTurnStartedAtRef.current !== null
        ? Math.max(0, Date.now() - currentTurnStartedAtRef.current)
        : 0;
    const totalTurnTimeMs = localTurnTimeMsRef.current + inProgressTurnMs;

    submittedTurnTimeGamesRef.current.add(gameId);
    submitEndGameTurnTime(gameId, uid, totalTurnTimeMs).catch((submitError) => {
      submittedTurnTimeGamesRef.current.delete(gameId);
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Unable to submit turn time.";
      setActionSyncError(message);
    });
  }, [firebaseReady, game, gameId, isGameComplete, isLocalPlayer, uid]);
  useEffect(() => {
    if (!isModeTooltipOpen) {
      return;
    }

    const handlePointer = (event: MouseEvent | TouchEvent) => {
      if (!modeTooltipRef.current) {
        return;
      }
      if (!modeTooltipRef.current.contains(event.target as Node)) {
        setIsModeTooltipOpen(false);
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsModeTooltipOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isModeTooltipOpen]);
  useEffect(() => {
    if (isGameComplete && !hasGameCompletedRef.current) {
      setIsFinalScoresOpen(true);
      hasGameCompletedRef.current = true;
      return;
    }

    if (!isGameComplete) {
      setIsFinalScoresOpen(false);
      hasGameCompletedRef.current = false;
    }
  }, [isGameComplete]);

  useEffect(() => {
    const shouldPlay = shouldPlayBetweenRounds && isBackgroundMusicEnabled;
    shouldPlayBetweenRoundsRef.current = shouldPlay;
    if (shouldPlay) {
      void startBetweenRoundsAudio();
      return;
    }
    stopBetweenRoundsAudio();
  }, [isBackgroundMusicEnabled, shouldPlayBetweenRounds]);
  const allPlayersReady = useMemo(() => {
    if (!isRoundComplete || !orderedPlayers.length) {
      return false;
    }
    return orderedPlayers.every((player) => player.isReady);
  }, [isRoundComplete, orderedPlayers]);
  const isLocalPlayerReady = useMemo(() => {
    if (!uid) {
      return false;
    }
    return orderedPlayers.find((player) => player.id === uid)?.isReady ?? false;
  }, [orderedPlayers, uid]);
  const hasColdRoundScore = useMemo(() => {
    if (!isRoundComplete) {
      return false;
    }
    const scores = game?.roundScores ?? {};
    return Object.values(scores).some((score) => score <= -5);
  }, [game?.roundScores, isRoundComplete]);
  const hasClearingRoundScore = useMemo(() => {
    if (!isRoundComplete) {
      return false;
    }
    return (game?.roundClearingPlayerIds?.length ?? 0) > 0;
  }, [game?.roundClearingPlayerIds, isRoundComplete]);
  const hasSpikedRoundScore = useMemo(() => {
    if (!isRoundComplete) {
      return false;
    }
    return orderedPlayers.some((player) => player.roundSpiked);
  }, [isRoundComplete, orderedPlayers]);
  const selectedPlayer = useMemo(
    () =>
      orderedPlayers.find((player) => hasCardValue(player.pendingDraw)) ?? null,
    [orderedPlayers],
  );
  const selectedDiscardPlayer = useMemo(
    () =>
      game?.selectedDiscardPlayerId
        ? (orderedPlayers.find(
            (player) => player.id === game.selectedDiscardPlayerId,
          ) ?? null)
        : null,
    [game?.selectedDiscardPlayerId, orderedPlayers],
  );
  const discardSelectedCard =
    selectedDiscardPlayer && hasDiscard ? topDiscard : null;
  const selectedCardOwnerLabel = selectedPlayer
    ? selectedPlayer.id === uid
      ? "You drew this card"
      : `${selectedPlayer.displayName} drew this card`
    : selectedDiscardPlayer
      ? selectedDiscardPlayer.id === uid
        ? "You selected this card"
        : `${selectedDiscardPlayer.displayName} selected this card`
      : "Awaiting a drawn card";
  const awaitingDrawSourceLabel = currentPlayer
    ? currentPlayer.id === uid
      ? "Your turn to draw"
      : `${currentPlayer.displayName}'s turn`
    : "Awaiting draw source";
  const selectedCardSourceLabel = selectedPlayer
    ? selectedPlayer.pendingDrawSource === "discard"
      ? "From discard pile"
      : "From draw pile"
    : selectedDiscardPlayer
      ? "From discard pile"
      : awaitingDrawSourceLabel;
  const pendingDrawnCard = currentPlayer?.pendingDraw ?? null;
  const pendingItemCard = isItemCard(pendingDrawnCard)
    ? pendingDrawnCard
    : null;
  const isPendingItem = pendingItemCard !== null;
  const isResolvingItem =
    isCurrentTurn &&
    isGameActive &&
    game?.turnPhase === "resolve-item" &&
    isPendingItem;
  const isItemRevealPending =
    pendingItemReveal &&
    isCurrentTurn &&
    isGameActive &&
    game?.turnPhase === "resolve";
  const isRevealRecoveryActive =
    isCurrentTurn &&
    isGameActive &&
    game?.turnPhase === "resolve" &&
    !hasCardValue(currentPlayer?.pendingDraw) &&
    !isSprinting;
  const discardSelectionActive =
    Boolean(game?.selectedDiscardPlayerId) &&
    game?.selectedDiscardPlayerId === uid;
  const canDrawFromDeck =
    isCurrentTurn &&
    isGameActive &&
    game?.turnPhase === "choose-draw" &&
    !hasCardValue(currentPlayer?.pendingDraw) &&
    !discardSelectionActive &&
    !isSubmittingAction &&
    (game?.deck.length ?? 0) > 0;
  const canSelectDiscardTarget =
    isCurrentTurn &&
    isGameActive &&
    game?.turnPhase === "choose-draw" &&
    !hasCardValue(currentPlayer?.pendingDraw) &&
    !isSprinting &&
    !isSubmittingAction &&
    (game?.discard.length ?? 0) > 0;
  const showDrawnCard =
    isCurrentTurn && hasCardValue(currentPlayer?.pendingDraw);
  const showSelectedCard =
    hasCardValue(selectedPlayer?.pendingDraw) || discardSelectedCard !== null;
  const selectedCardValue = selectedPlayer?.pendingDraw ?? discardSelectedCard;
  const selectedCardAnimationSignature = showSelectedCard
    ? JSON.stringify({
        ownerId: selectedPlayer?.id ?? selectedDiscardPlayer?.id ?? null,
        source: selectedPlayer?.pendingDrawSource ?? "discard",
        card: selectedCardValue,
      })
    : null;
  const selectedCardMaskStyle = useMemo(
    () =>
      ({
        "--selected-mask-image": `url("/animations/selected.GIF?play=${selectedCardAnimationId}")`,
      }) as CSSProperties,
    [selectedCardAnimationId],
  );
  const selectedCardLabel = getCardLabel(selectedCardValue);
  const canSelectGridCard =
    isGameActive &&
    (showDrawnCard ||
      discardSelectionActive ||
      isItemRevealPending ||
      isRevealRecoveryActive) &&
    !isResolvingItem &&
    !isSubmittingAction;
  const itemValueOptions = useMemo(
    () => Array.from({ length: 16 }, (_, index) => index - 2),
    [],
  );
  const pendingItem = isPendingItem ? pendingItemCard : null;
  const itemCode = pendingItem?.code ?? null;
  const itemName = itemCode
    ? (itemCardDetails[itemCode]?.name ?? itemCode)
    : null;
  const itemTargetsNeeded =
    itemCode === "E" || itemCode === "H"
      ? 2
      : itemCode === "F" || itemCode === "G"
        ? 0
        : itemCode
          ? 1
          : 0;
  const itemRequiresValue = itemCode === "C";
  const itemTargetsReady = itemTargets.length === itemTargetsNeeded;
  const itemCardTargets = itemTargets.filter(isCardTarget);
  const itemValueReady = !itemRequiresValue || itemValue !== null;
  const canUseItem = Boolean(itemCode && itemTargetsReady && itemValueReady);
  const isCrossPlayerSwap =
    itemCode === "E" &&
    itemCardTargets.length === 2 &&
    itemCardTargets[0].playerId !== itemCardTargets[1].playerId;
  const previousSelectedCardSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedCardAnimationSignature) {
      previousSelectedCardSignatureRef.current = null;
      return;
    }

    if (
      previousSelectedCardSignatureRef.current !==
      selectedCardAnimationSignature
    ) {
      previousSelectedCardSignatureRef.current = selectedCardAnimationSignature;
      setSelectedCardAnimationId((currentId) => currentId + 1);
    }
  }, [selectedCardAnimationSignature]);
  const showDrawActions = showDrawnCard && !isPendingItem;
  const itemCardSelectionActive = isResolvingItem && itemTargetsNeeded > 0;
  const itemTargetInstruction =
    itemCode === "H"
      ? itemTargets.length === 0
        ? "Select the card with the value to copy first."
        : itemTargets.length === 1
          ? "Select the card to update second."
          : "Targets selected."
      : itemTargets.length === 0
        ? itemTargetsNeeded === 1
          ? "Select a target card."
          : "Select two target cards."
        : itemTargets.length < itemTargetsNeeded
          ? "Select a second target."
          : "Targets selected.";
  const canDiscardItem =
    isResolvingItem &&
    Boolean(itemCode) &&
    currentPlayer?.pendingDrawSource === "deck" &&
    !isSprinting &&
    !isSubmittingAction;
  const itemDescriptions: Record<string, string> = {
    C: "Set a card on your own board to any value.",
    E: "Swap two cards on your own board.",
    F: "Summon a mist that hides your grid from prying eyes. Lasts 5 turns.",
    G: "Draw three from the draw pile. You may not reveal cards during a push.",
    H: "Pick one of your cards, then set another card to its' value.",
  };
  const isItemDrawnByOtherPlayer =
    isGameActive &&
    game?.turnPhase === "resolve-item" &&
    isPendingItem &&
    !isCurrentTurn;
  const itemOwnerName = currentPlayer?.displayName ?? "A player";
  const isLocalFinalTurn =
    uid !== null &&
    Boolean(game?.endingPlayerId) &&
    game?.endingPlayerId !== uid &&
    game?.currentPlayerId === uid &&
    Boolean(game?.finalTurnRemainingIds?.includes(uid));

  useEffect(() => {
    if (!game || !uid || !isGameActive) {
      return;
    }

    const turnKey = `${game.roundNumber}-${game.currentPlayerId ?? "none"}`;

    if (!hasInitializedTurnSoundRef.current) {
      hasInitializedTurnSoundRef.current = true;
      lastTurnSoundKeyRef.current = turnKey;
      return;
    }

    if (
      game.currentPlayerId === uid &&
      lastTurnSoundKeyRef.current !== turnKey
    ) {
      if (isLocalFinalTurn) {
        playSound("/sounds/notifications/final-turn.wav");
      } else {
        playSound("/sounds/notifications/your-turn.wav");
      }
    }

    lastTurnSoundKeyRef.current = turnKey;
  }, [game, isGameActive, isLocalFinalTurn, uid]);

  useEffect(() => {
    if (!isCurrentTurn || !isGameActive) {
      return;
    }

    const timeout = window.setTimeout(() => {
      playSound("/sounds/notifications/hey-your-turn.wav");
    }, 20000);

    return () => window.clearTimeout(timeout);
  }, [isCurrentTurn, isGameActive]);
  const spectatorCount = useMemo(() => {
    if (!spectators.length) {
      return 0;
    }
    const playerIds = new Set(players.map((player) => player.id));
    return spectators.filter((spectator) => !playerIds.has(spectator.id))
      .length;
  }, [players, spectators]);

  const spectatorNames = useMemo(() => {
    if (!spectators.length) {
      return [];
    }
    const playerIds = new Set(players.map((player) => player.id));
    return spectators
      .filter((spectator) => !playerIds.has(spectator.id))
      .map((spectator) => spectator.displayName);
  }, [players, spectators]);

  const endingPlayerName = useMemo(() => {
    if (!game?.endingPlayerId) {
      return null;
    }
    return (
      players.find((player) => player.id === game.endingPlayerId)
        ?.displayName ?? "A player"
    );
  }, [game?.endingPlayerId, players]);

  useEffect(() => {
    if (!showDrawnCard || !showFirstTimeTips) {
      return;
    }

    setToastMessage(drawTipMessage);
    const timeout = window.setTimeout(() => {
      setToastMessage(null);
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [showDrawnCard]);

  useEffect(() => {
    if (!discardSelectionActive || !showFirstTimeTips) {
      return;
    }

    setToastMessage(discardTipMessage);
    const timeout = window.setTimeout(() => {
      setToastMessage(null);
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [discardSelectionActive, showFirstTimeTips]);

  useEffect(() => {
    if (showFirstTimeTips) {
      return;
    }

    if (toastMessage === drawTipMessage || toastMessage === discardTipMessage) {
      setToastMessage(null);
    }
  }, [drawTipMessage, discardTipMessage, showFirstTimeTips, toastMessage]);

  useEffect(() => {
    if (pendingItemReveal) {
      setToastMessage(itemRevealTipMessage);
      return;
    }
    if (toastMessage === itemRevealTipMessage) {
      setToastMessage(null);
    }
  }, [itemRevealTipMessage, pendingItemReveal, toastMessage]);

  useEffect(() => {
    if (isRevealRecoveryActive) {
      setToastMessage(recoveryRevealTipMessage);
      return;
    }
    if (toastMessage === recoveryRevealTipMessage) {
      setToastMessage(null);
    }
  }, [isRevealRecoveryActive, recoveryRevealTipMessage, toastMessage]);

  useEffect(() => {
    if (!pendingItemReveal) {
      return;
    }
    const isRevealPhase =
      game?.turnPhase === "resolve" || game?.turnPhase === "resolve-item";
    if (!isCurrentTurn || !isGameActive || !isRevealPhase) {
      setPendingItemReveal(false);
    }
  }, [game?.turnPhase, isCurrentTurn, isGameActive, pendingItemReveal]);

  useEffect(() => {
    const element = gamePilesRef.current;
    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setShowDockedPiles(!entry.isIntersecting);
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!game?.endingPlayerId || !endingPlayerName) {
      return;
    }

    if (endingAnnouncementRef.current === game.endingPlayerId) {
      return;
    }

    endingAnnouncementRef.current = game.endingPlayerId;
    setToastMessage(
      `${endingPlayerName} revealed all cards. Everyone gets one final turn!`,
    );
    const timeout = window.setTimeout(() => {
      setToastMessage(null);
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [endingPlayerName, game?.endingPlayerId]);

  useEffect(() => {
    if (!game?.endingPlayerId) {
      setDismissedFinalTurnForEndingPlayerId(null);
      setIsFinalTurnOverlayOpen(false);
      return;
    }

    if (
      dismissedFinalTurnForEndingPlayerId !== game.endingPlayerId &&
      isLocalFinalTurn
    ) {
      setIsFinalTurnOverlayOpen(true);
      return;
    }

    if (!isLocalFinalTurn) {
      setIsFinalTurnOverlayOpen(false);
    }
  }, [
    dismissedFinalTurnForEndingPlayerId,
    game?.endingPlayerId,
    isLocalFinalTurn,
  ]);

  const handleDismissFinalTurnOverlay = () => {
    if (game?.endingPlayerId) {
      setDismissedFinalTurnForEndingPlayerId(game.endingPlayerId);
    }
    setIsFinalTurnOverlayOpen(false);
  };

  useEffect(() => {
    if (!isRoundComplete) {
      setIsSpikedOverlayOpen(false);
      setIsColdOverlayOpen(false);
      setIsClearingOverlayOpen(false);
      return;
    }

    if (hasSpikedRoundScore && typeof game?.roundNumber === "number") {
      setIsColdOverlayOpen(false);
      setIsClearingOverlayOpen(false);
      if (dismissedSpikedOverlayRound !== game.roundNumber) {
        setIsSpikedOverlayOpen(true);
        return;
      }
      setIsSpikedOverlayOpen(false);
      return;
    }

    setIsSpikedOverlayOpen(false);

    if (hasClearingRoundScore && typeof game?.roundNumber === "number") {
      setIsColdOverlayOpen(false);
      if (dismissedClearingOverlayRound !== game.roundNumber) {
        setIsClearingOverlayOpen(true);
        return;
      }
      setIsClearingOverlayOpen(false);
      return;
    }

    setIsClearingOverlayOpen(false);

    if (!hasColdRoundScore || typeof game?.roundNumber !== "number") {
      setIsColdOverlayOpen(false);
      return;
    }

    if (dismissedColdOverlayRound !== game.roundNumber) {
      setIsColdOverlayOpen(true);
      return;
    }

    setIsColdOverlayOpen(false);
  }, [
    dismissedClearingOverlayRound,
    dismissedColdOverlayRound,
    dismissedSpikedOverlayRound,
    game?.roundNumber,
    hasClearingRoundScore,
    hasColdRoundScore,
    hasSpikedRoundScore,
    isRoundComplete,
  ]);

  const handleDismissSpikedOverlay = () => {
    if (typeof game?.roundNumber === "number") {
      setDismissedSpikedOverlayRound(game.roundNumber);
    }
    setIsSpikedOverlayOpen(false);
  };

  const handleDismissColdOverlay = () => {
    if (typeof game?.roundNumber === "number") {
      setDismissedColdOverlayRound(game.roundNumber);
    }
    setIsColdOverlayOpen(false);
  };

  const handleDismissClearingOverlay = () => {
    if (typeof game?.roundNumber === "number") {
      setDismissedClearingOverlayRound(game.roundNumber);
    }
    setIsClearingOverlayOpen(false);
  };

  const finalScores = useMemo(() => {
    if (!isGameComplete) {
      return [];
    }
    return [...orderedPlayers]
      .map((player) => ({
        id: player.id,
        displayName: player.displayName,
        totalScore: player.totalScore ?? 0,
      }))
      .sort((a, b) => {
        if (a.totalScore !== b.totalScore) {
          return a.totalScore - b.totalScore;
        }
        return a.displayName.localeCompare(b.displayName);
      });
  }, [isGameComplete, orderedPlayers]);

  const localPlayerFinalStanding = useMemo(
    () => finalScores.findIndex((entry) => entry.id === uid),
    [finalScores, uid],
  );
  const localPlayerSummary = useMemo(
    () => playerSummaries.find((player) => player.id === uid) ?? null,
    [playerSummaries, uid],
  );
  const earnedXpBreakdown = useMemo(() => {
    if (localPlayerFinalStanding < 0) {
      return null;
    }

    return getTotalEarnedXpBreakdown({
      finalRank: localPlayerFinalStanding + 1,
      lobbySize: Math.max(finalScores.length, 2),
      pointsClearedFromRows: localPlayerSummary?.pointsClearedFromRows ?? 0,
    });
  }, [
    finalScores.length,
    localPlayerFinalStanding,
    localPlayerSummary?.pointsClearedFromRows,
  ]);
  const unlockedRewardMessage = useMemo(() => {
    if (!localPlayerExperiencePreview?.unlockedRewardLevels.length) {
      return null;
    }

    const rewardLevels = localPlayerExperiencePreview.unlockedRewardLevels.map(
      (level) => `Level ${level}`,
    );

    if (rewardLevels.length === 1) {
      return `${rewardLevels[0]} reward unlocked`;
    }

    return `${rewardLevels.join(", ")} rewards unlocked`;
  }, [localPlayerExperiencePreview?.unlockedRewardLevels]);

  const finalStatsRows = useMemo(() => {
    if (!isGameComplete) {
      return [];
    }

    return finalScores.map((scoreEntry, index) => {
      const playerSummary = players.find(
        (player) => player.id === scoreEntry.id,
      );
      const totalTurnLengthMs =
        game?.turnTimeSubmissionsMs?.[scoreEntry.id] ?? 0;
      return {
        id: scoreEntry.id,
        rank: index + 1,
        displayName: scoreEntry.displayName,
        totalScore: scoreEntry.totalScore,
        totalTurnLength: formatTurnLength(totalTurnLengthMs),
        averageDiscardedCardValue: formatAverageValue(
          playerSummary?.pointsDiscarded ?? 0,
          playerSummary?.discardedCardCount ?? 0,
        ),
        averageRevealedCardValue: formatAverageValue(
          playerSummary?.revealedCardValueTotal ?? 0,
          playerSummary?.revealedCardCount ?? 0,
        ),
        pointsClearedFromRows: playerSummary?.pointsClearedFromRows ?? 0,
        itemCardsDrawn: playerSummary?.itemCardsDrawn ?? 0,
      };
    });
  }, [finalScores, game?.turnTimeSubmissionsMs, isGameComplete, players]);

  const finalRoundScores = useMemo(() => {
    if (!isGameComplete || !game?.roundScores) {
      return [];
    }

    return [...orderedPlayers]
      .map((player) => ({
        id: player.id,
        displayName: player.displayName,
        roundScore: game.roundScores?.[player.id] ?? 0,
        totalScore: player.totalScore ?? 0,
        roundSpiked: Boolean(player.roundSpiked),
      }))
      .sort((a, b) => a.roundScore - b.roundScore);
  }, [game?.roundScores, isGameComplete, orderedPlayers]);

  const endGameBonuses = useMemo(() => {
    if (
      !isGameComplete ||
      !game?.spikeMode ||
      game?.spikeEndGameBonuses === false
    ) {
      return [];
    }

    const mostRowsWinnerId =
      game?.endGameBonusResults?.mostRowsClearedWinnerId ?? null;
    const lowestDiscardedWinnerId =
      game?.endGameBonusResults?.lowestDiscardedWinnerId ?? null;
    const fastestPlayerWinnerId =
      game?.endGameBonusResults?.fastestPlayerWinnerId ?? null;
    const getDisplayName = (playerId: string | null) =>
      playerId
        ? (orderedPlayers.find((player) => player.id === playerId)
            ?.displayName ?? "Unknown player")
        : "No winner";

    return [
      {
        id: "rows",
        title: "Most points cleared (rows + columns)",
        winnerName: getDisplayName(mostRowsWinnerId),
      },
      {
        id: "discard",
        title: "Lowest points discarded",
        winnerName: getDisplayName(lowestDiscardedWinnerId),
      },
      {
        id: "fastest",
        title: "Fastest player",
        winnerName: getDisplayName(fastestPlayerWinnerId),
      },
    ];
  }, [
    game?.endGameBonusResults,
    game?.spikeEndGameBonuses,
    game?.spikeMode,
    isGameComplete,
    orderedPlayers,
  ]);

  useEffect(() => {
    if (!isGameComplete || !isFinalScoresOpen || !endGameBonuses.length) {
      setRevealedBonusCount(0);
      return;
    }

    setRevealedBonusCount(0);
    const timeouts = endGameBonuses.map((_, index) =>
      window.setTimeout(
        () => {
          setRevealedBonusCount(index + 1);
        },
        BONUS_ANNOUNCEMENT_DURATION_MS * (index + 1),
      ),
    );

    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, [endGameBonuses, isFinalScoresOpen, isGameComplete]);

  useEffect(() => {
    if (!firebaseReady || !gameId || !isGameComplete || !finalScores.length) {
      return;
    }

    const isAwaitingFastestBonus =
      game?.spikeMode &&
      game?.spikeEndGameBonuses !== false &&
      !game?.endGameBonusResults?.fastestPlayerWinnerId;
    if (isAwaitingFastestBonus) {
      return;
    }

    if (finalScores.length < 2) {
      return;
    }

    if (leaderboardUpdateRef.current.has(gameId)) {
      return;
    }
    leaderboardUpdateRef.current.add(gameId);

    const updateLeaderboard = async () => {
      const leaderboardRef = collection(db, "leaderboard");
      const leaderboardQuery = query(leaderboardRef, orderBy("score", "asc"));
      const leaderboardSnapshot = await getDocs(leaderboardQuery);
      const expiredEntries = leaderboardSnapshot.docs.filter(
        (entry) => !isLeaderboardEntryActive(entry.data().expiresAt),
      );
      if (expiredEntries.length) {
        await Promise.all(expiredEntries.map((entry) => deleteDoc(entry.ref)));
      }

      const leaderboardScores = leaderboardSnapshot.docs
        .filter((entry) => isLeaderboardEntryActive(entry.data().expiresAt))
        .slice(0, 10)
        .map((entry) => entry.data().score)
        .filter((score): score is number => typeof score === "number");
      const cutoffScore =
        leaderboardScores.length < 10 ? null : Math.max(...leaderboardScores);
      const qualifyingScores = finalScores.filter((entry) => {
        if (leaderboardScores.length < 10) {
          return true;
        }
        if (cutoffScore === null) {
          return true;
        }
        return entry.totalScore <= cutoffScore;
      });

      if (!qualifyingScores.length) {
        return;
      }

      await Promise.all(
        qualifyingScores.map((entry) =>
          setDoc(
            doc(leaderboardRef, `${gameId}_${entry.id}`),
            {
              displayName: entry.displayName,
              score: entry.totalScore,
              gameId,
              playerId: entry.id,
              createdAt: serverTimestamp(),
              expiresAt: Timestamp.fromMillis(
                Date.now() + LEADERBOARD_ENTRY_TTL_MS,
              ),
            },
            { merge: true },
          ),
        ),
      );
    };

    updateLeaderboard().catch((err: Error) => setError(err.message));
  }, [
    firebaseReady,
    finalScores,
    game?.endGameBonusResults?.fastestPlayerWinnerId,
    game?.spikeEndGameBonuses,
    game?.spikeMode,
    gameId,
    isGameComplete,
  ]);

  useEffect(() => {
    if (
      !firebaseReady ||
      !gameId ||
      !uid ||
      isAnonymousUser ||
      !isGameComplete ||
      !finalScores.length
    ) {
      return;
    }

    if (userLastFiveGamesUpdateRef.current.has(gameId)) {
      return;
    }
    userLastFiveGamesUpdateRef.current.add(gameId);

    const updateUserLastFiveGames = async () => {
      const updatedPreview = await updateCompletedGameProfile({
        gameId,
        finalScores,
        playerSummaries,
        uid,
      });

      if (updatedPreview) {
        setLocalPlayerExperiencePreview(updatedPreview);
      }
    };

    updateUserLastFiveGames().catch((err: Error) => {
      userLastFiveGamesUpdateRef.current.delete(gameId);
      setError(err.message);
    });
  }, [
    firebaseReady,
    finalScores,
    gameId,
    isAnonymousUser,
    isGameComplete,
    uid,
  ]);

  useEffect(() => {
    if (!canSelectGridCard) {
      setActiveActionIndex(null);
    }
  }, [canSelectGridCard]);

  useEffect(() => {
    if (!isResolvingItem || !itemCode) {
      setItemTargets([]);
      setItemValue(null);
      setIsSwapConfirmOpen(false);
      return;
    }
    setItemTargets([]);
    setItemValue(null);
    setIsSwapConfirmOpen(false);
  }, [isResolvingItem, itemCode]);

  useEffect(() => {
    if (!firebaseReady || !gameId || !uid) {
      return;
    }

    const spectatorRef = doc(db, "games", gameId, "spectators", uid);
    if (isLocalPlayer) {
      deleteDoc(spectatorRef).catch((err: Error) => setError(err.message));
      return;
    }

    const resolvedName = window.localStorage.getItem("misty:username")?.trim();
    setDoc(
      spectatorRef,
      {
        displayName: resolvedName || "Anonymous spectator",
        joinedAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
      },
      { merge: true },
    ).catch((err: Error) => setError(err.message));

    return () => {
      deleteDoc(spectatorRef).catch(() => undefined);
    };
  }, [firebaseReady, gameId, isLocalPlayer, uid]);

  useEffect(() => {
    return () => {
      if (actionWatchdogTimerRef.current !== null) {
        window.clearTimeout(actionWatchdogTimerRef.current);
      }
    };
  }, []);

  const handleDrawFromDeck = async () => {
    if (!uid) {
      setError("Sign in to draw a card.");
      return;
    }
    if (!gameId) {
      setError("Missing game ID.");
      return;
    }
    if (!canDrawFromDeck) {
      return;
    }

    await runWithActionSubmission(async () => {
      await drawFromDeck(gameId, uid);
    });
  };

  const handleSelectGridCard = (index: number) => {
    if (!canSelectGridCard) {
      return;
    }
    if (isItemRevealPending || isRevealRecoveryActive) {
      void handleRevealAfterItemDiscard(index);
      return;
    }
    if (discardSelectionActive) {
      void handleDrawFromDiscard(index);
      return;
    }
    setActiveActionIndex(index);
  };

  const handleDrawFromDiscard = async (targetIndex: number) => {
    if (!uid) {
      setError("Sign in to draw a card.");
      return;
    }
    if (!gameId) {
      setError("Missing game ID.");
      return;
    }
    if (!canSelectDiscardTarget) {
      return;
    }

    await runWithActionSubmission(async () => {
      await drawFromDiscard(gameId, uid, targetIndex);
      setActiveActionIndex(null);
    });
  };

  const handleSelectDiscard = async () => {
    if (!canSelectDiscardTarget) {
      return;
    }
    if (!uid) {
      setError("Sign in to draw a card.");
      return;
    }
    if (!gameId) {
      setError("Missing game ID.");
      return;
    }

    await runWithActionSubmission(async () => {
      await selectDiscard(gameId, uid);
      setActiveActionIndex(null);
    });
  };

  const handleReplace = async (index: number) => {
    if (!uid) {
      setError("Sign in to replace a card.");
      return;
    }
    if (!gameId) {
      setError("Missing game ID.");
      return;
    }

    await runWithActionSubmission(async () => {
      await swapPendingDraw(gameId, uid, index);
      setActiveActionIndex(null);
    });
  };

  const handleReveal = async (index: number) => {
    if (!uid) {
      setError("Sign in to reveal a card.");
      return;
    }
    if (!gameId) {
      setError("Missing game ID.");
      return;
    }
    if (isSprinting) {
      setError("You cannot reveal or discard while sprinting.");
      return;
    }

    await runWithActionSubmission(async () => {
      await discardAndRevealPendingDraw(gameId, uid, index);
      setActiveActionIndex(null);
    });
  };

  const handleRevealAfterItemDiscard = async (index: number) => {
    if (!uid) {
      setError("Sign in to reveal a card.");
      return;
    }
    if (!gameId) {
      setError("Missing game ID.");
      return;
    }
    if (isSprinting) {
      setError("You cannot reveal or discard while sprinting.");
      return;
    }
    if (!isItemRevealPending) {
      return;
    }
    if (currentPlayer?.revealed?.[index]) {
      setError("Choose an unrevealed card to reveal.");
      return;
    }

    await runWithActionSubmission(async () => {
      await revealAfterDiscard(gameId, uid, index);
      setPendingItemReveal(false);
      setActiveActionIndex(null);
    });
  };

  const handleItemTargetSelect = (target: ItemTarget) => {
    if (!itemCode || !isResolvingItem || itemTargetsNeeded === 0) {
      return;
    }
    const isSameTarget = (left: ItemTarget, right: ItemTarget) =>
      left.playerId === right.playerId && left.index === right.index;
    setItemTargets((prev) => {
      const previousTargets = prev.filter(isCardTarget);
      let nextTargets: ItemTarget[] = [];
      if (itemTargetsNeeded === 1) {
        const existing = previousTargets[0];
        nextTargets =
          existing && isSameTarget(existing, target) ? [] : [target];
      } else {
        if (
          previousTargets.some((existing) => isSameTarget(existing, target))
        ) {
          nextTargets = previousTargets.filter(
            (existing) => !isSameTarget(existing, target),
          );
        } else if (previousTargets.length < 2) {
          nextTargets = [...previousTargets, target];
        } else {
          nextTargets = [target];
        }
      }
      if (itemCode === "C") {
        const previousTarget = previousTargets[0];
        const nextTarget = nextTargets[0];
        if (
          !previousTarget ||
          !nextTarget ||
          !isSameTarget(previousTarget, nextTarget)
        ) {
          setItemValue(null);
        }
      }
      return nextTargets;
    });
  };

  const handleResetItemSelection = () => {
    setItemTargets([]);
    setItemValue(null);
    setIsSwapConfirmOpen(false);
  };

  const handleUseItem = async (confirmSwap = false) => {
    if (!uid) {
      setError("Sign in to use an item.");
      return;
    }
    if (!gameId) {
      setError("Missing game ID.");
      return;
    }
    if (!itemCode || !pendingItem) {
      return;
    }
    if (!canUseItem) {
      return;
    }
    if (isCrossPlayerSwap && !confirmSwap) {
      setIsSwapConfirmOpen(true);
      return;
    }

    await runWithActionSubmission(async () => {
      const cardTargets = itemTargets.filter(isCardTarget);
      if (itemCode === "C") {
        await useItemCard(gameId, uid, {
          code: "C",
          target: cardTargets[0],
          value: itemValue ?? 0,
        });
      } else if (itemCode === "F") {
        await useItemCard(gameId, uid, { code: "F" });
      } else if (itemCode === "G") {
        await useItemCard(gameId, uid, { code: "G" });
      } else if (itemCode === "E") {
        await useItemCard(gameId, uid, {
          code: "E",
          first: cardTargets[0],
          second: cardTargets[1],
        });
      } else if (itemCode === "H") {
        await useItemCard(gameId, uid, {
          code: "H",
          first: cardTargets[0],
          second: cardTargets[1],
        });
      }
      handleResetItemSelection();
    });
  };

  const handleDiscardItem = async () => {
    if (!uid) {
      setError("Sign in to discard an item.");
      return;
    }
    if (!gameId) {
      setError("Missing game ID.");
      return;
    }
    if (!isResolvingItem) {
      return;
    }
    if (isSprinting) {
      setError("You cannot reveal or discard while sprinting.");
      return;
    }

    await runWithActionSubmission(async () => {
      await discardItemForReveal(gameId, uid);
      handleResetItemSelection();
      setPendingItemReveal(true);
      setActiveActionIndex(null);
    });
  };

  const runWithActionSubmission = async (action: () => Promise<void>) => {
    if (isSubmittingAction) {
      return;
    }

    setIsSubmittingAction(true);
    setActionSyncError(null);
    setError(null);
    let didTimeout = false;
    actionWatchdogTimerRef.current = window.setTimeout(() => {
      didTimeout = true;
      setActionSyncError(
        "Action is taking longer than expected. Tap Resync turn.",
      );
    }, 10000);

    try {
      await action();
      if (didTimeout) {
        setToastMessage("Action synced. Turn state refreshed.");
        setActionSyncError(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
      setActionSyncError("Action failed to sync. Tap Retry.");
    } finally {
      if (actionWatchdogTimerRef.current !== null) {
        window.clearTimeout(actionWatchdogTimerRef.current);
        actionWatchdogTimerRef.current = null;
      }
      setIsSubmittingAction(false);
    }
  };

  const handleResyncTurn = () => {
    if (!isCurrentTurn || !isGameActive || !uid || !game) {
      setToastMessage("Waiting for your turn.");
      return;
    }

    setActiveActionIndex(null);
    const hasPendingDraw = hasCardValue(currentPlayer?.pendingDraw);
    const isDiscardSelectedByLocalPlayer = game.selectedDiscardPlayerId === uid;
    const needsRevealRecovery =
      game.turnPhase === "resolve" &&
      !hasPendingDraw &&
      !isSprinting &&
      !isResolvingItem;

    if (game.turnPhase === "choose-draw") {
      setToastMessage(
        isDiscardSelectedByLocalPlayer
          ? "Discard selected. Tap one of your cards to swap with discard."
          : "Tap deck or discard to choose your draw source.",
      );
    } else if (game.turnPhase === "resolve-item" && isResolvingItem) {
      setToastMessage(
        "Resolve the item using the item panel options below the piles.",
      );
    } else if (isItemRevealPending || needsRevealRecovery) {
      setToastMessage(
        "Tap an unrevealed card on your grid to reveal and finish your turn.",
      );
    } else if (hasPendingDraw) {
      setToastMessage("Tap one of your cards, then choose Trade or Reveal.");
    } else {
      setToastMessage(
        "Turn synced. Follow the highlighted controls to continue.",
      );
    }

    setActionSyncError(null);
  };

  const handleCancelMenu = () => {
    setActiveActionIndex(null);
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
  };

  const handleOpenLeaveGameModal = () => {
    setIsLeaveGameModalOpen(true);
  };

  const handleCloseLeaveGameModal = () => {
    setIsLeaveGameModalOpen(false);
  };

  const handleConfirmLeaveGame = async () => {
    if (!uid) {
      setError("Sign in to leave the game.");
      return;
    }
    if (!gameId) {
      setError("Missing game ID.");
      return;
    }

    setError(null);
    try {
      await leaveGame(gameId, uid);
      handleCloseLeaveGameModal();
      handleCloseSettings();
      router.push("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  };

  const handleStartNextRound = async () => {
    if (!uid) {
      setError("Sign in to start the next round.");
      return;
    }
    if (!gameId) {
      setError("Missing game ID.");
      return;
    }
    if (!isHost) {
      setError("Only the host can start the next round.");
      return;
    }
    if (game?.status !== "round-complete") {
      return;
    }
    if (!allPlayersReady) {
      setError("All players must be ready to start the next round.");
      return;
    }

    setIsStartingNextRound(true);
    setError(null);
    try {
      await startNextRound(gameId, uid);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsStartingNextRound(false);
    }
  };

  const handleReadyForNextRound = async () => {
    if (!uid) {
      setError("Sign in to ready up for the next round.");
      return;
    }
    if (!gameId) {
      setError("Missing game ID.");
      return;
    }
    if (game?.status !== "round-complete") {
      return;
    }

    setError(null);
    try {
      await readyForNextRound(gameId, uid);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  };

  if (!gameId) {
    return (
      <div className="notice">
        <strong>Loading game...</strong>
        <p>Waiting for a game ID before connecting to Firestore.</p>
      </div>
    );
  }

  if (!firebaseReady) {
    return (
      <div className="notice">
        <strong>Firestore is not connected yet.</strong>
        <p>Provide your Firebase environment variables to load game data.</p>
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
    <>
      <LoadingSwipeOverlay isVisible={showLoadingOverlay} />
      {isSnowEnabled ? <SnowfallLayer height={"185%"} /> : null}

      <main
        className={`container game-screen${isCurrentTurn ? " game-screen--current-turn " : ""}`}
      >
        <div className="game-screen__tags">
          <span className="game-screen__tag" title={lobbyLabel}>
            {lobbyLabel}
          </span>
          <div className="game-screen__tag-tooltip" ref={modeTooltipRef}>
            <button
              type="button"
              className="game-screen__tag game-screen__tag--mode"
              aria-describedby="game-mode-tooltip"
              aria-expanded={isModeTooltipOpen}
              onClick={() => setIsModeTooltipOpen((prev) => !prev)}
            >
              {modeLabel}
            </button>
            <span
              id="game-mode-tooltip"
              role="tooltip"
              className={`game-screen__tag-tooltip-content${
                isModeTooltipOpen ? " is-visible" : ""
              }`}
            >
              {modeLabelTitle}
            </span>
          </div>
        </div>
        <div className="spectator-count">
          <button
            type="button"
            className="spectator-count__button"
            aria-label={`Spectators: ${spectatorCount}`}
            aria-haspopup="dialog"
            onClick={() => setIsSpectatorModalOpen(true)}
          >
            <img className="eye-icon" src="/eye-icon.png" />
            <span className="spectator-count__value">{spectatorCount}</span>
          </button>
          <button
            type="button"
            className="settings-button"
            aria-label="Open settings"
            onClick={() => {
              setIsSettingsOpen(true);
            }}
          >
            <img className="settings-icon" src="/settings-icon.png" />
          </button>
        </div>
        {isGameComplete ? (
          <div className="game-complete-actions">
            <button
              type="button"
              className="form-button-full-width"
              onClick={() => setIsFinalScoresOpen(true)}
            >
              View final scores
            </button>
          </div>
        ) : null}
        {isSpectatorModalOpen ? (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="spectator-list-title"
            onClick={() => setIsSpectatorModalOpen(false)}
          >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <h2 className="sage-eyebrow-text">Spectators</h2>
              {spectatorNames.length ? (
                <ul className="player-list">
                  {spectatorNames.map((name, index) => (
                    <li key={`${name}-${index}`} className="player-list-item">
                      {name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No spectators yet.</p>
              )}
              <div className="modal__actions">
                <button
                  className="form-button-full-width"
                  type="button"
                  onClick={() => setIsSpectatorModalOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {isLeaderboardOpen ? (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leaderboard-title"
            onClick={() => setIsLeaderboardOpen(false)}
          >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <h2 className="leaderboard-title" id="leaderboard-title">
                Leaderboard
              </h2>
              <p>Lowest 10 scores of the season.</p>
              <p className="leaderboard-sub text-xs">
                Entries expire after 90 days
              </p>
              {leaderboardEntries.length ? (
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
                <p>No scores yet. Finish a game to claim a spot!</p>
              )}
              <div className="modal__actions">
                <button
                  className="form-button-full-width"
                  type="button"
                  onClick={() => setIsLeaderboardOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {isSwapConfirmOpen ? (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="swap-confirm-title"
            onClick={() => setIsSwapConfirmOpen(false)}
          >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <h2 id="swap-confirm-title">Confirm swap</h2>
              <p>You're swapping two cards across players.</p>
              <div className="item-panel__target-list">
                {itemTargets.filter(isCardTarget).map((target, index) => (
                  <div
                    key={`${target.playerId}-${target.index}`}
                    className="item-panel__target-pill"
                  >
                    <span className="item-panel__target-order">
                      {index + 1}
                    </span>
                    <span>{getItemTargetLabel(target)}</span>
                  </div>
                ))}
              </div>
              <div className="modal__actions">
                <button
                  type="button"
                  className="form-button-full-width"
                  onClick={() => handleUseItem(true)}
                >
                  Confirm swap
                </button>
                <button
                  type="button"
                  className="form-button-full-width"
                  onClick={() => setIsSwapConfirmOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {toastMessage ? (
          <div className="toast" role="status" aria-live="polite">
            {toastMessage}
          </div>
        ) : null}
        {shouldShowAutoFollowWidget ? (
          <div className="auto-follow-widget">
            <label className="auto-follow-widget__label modal__option-label modal__option-toggle">
              <span>Auto-Follow</span>
              <span className="toggle">
                <input
                  className="toggle__input"
                  type="checkbox"
                  checked={isAutoFollowEnabled}
                  onChange={(event) => {
                    setIsAutoFollowEnabled(event.target.checked);
                    setIsAutoFollowSuspended(false);
                  }}
                />
                <span className="toggle__track" aria-hidden="true" />
              </span>
            </label>
          </div>
        ) : null}
        {isFinalTurnOverlayOpen ? (
          <div
            className="final-turn-overlay"
            role="button"
            tabIndex={0}
            aria-label="Dismiss last turn announcement"
            onClick={handleDismissFinalTurnOverlay}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleDismissFinalTurnOverlay();
              }
            }}
          >
            <div className="final-turn-overlay__message">
              <span className="final-turn-triggerer">
                {`${endingPlayerName ?? "A player"} finished!`}
              </span>
              <br />
              Last turn
            </div>
          </div>
        ) : null}
        {isColdOverlayOpen ? (
          <div
            className="cold-overlay"
            role="button"
            tabIndex={0}
            aria-label="Dismiss cold bonus message"
            onClick={handleDismissColdOverlay}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleDismissColdOverlay();
              }
            }}
          >
            <div className="cold-overlay__message">that's cold</div>
          </div>
        ) : null}
        {isSpikedOverlayOpen ? (
          <div
            className="spiked-overlay"
            role="button"
            tabIndex={0}
            aria-label="Dismiss spiked celebration"
            onClick={handleDismissSpikedOverlay}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleDismissSpikedOverlay();
              }
            }}
          >
            <div className="spiked-overlay__message">SPIKED</div>
          </div>
        ) : null}
        {isClearingOverlayOpen ? (
          <div
            className="clearing-overlay"
            role="button"
            tabIndex={0}
            aria-label="Dismiss clearing celebration"
            onClick={handleDismissClearingOverlay}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleDismissClearingOverlay();
              }
            }}
          >
            <div className="clearing-overlay__message">Clearing!</div>
          </div>
        ) : null}
        {isSettingsOpen ? (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-settings-title"
            onClick={handleCloseSettings}
          >
            <div
              className="modal modal--game-settings"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="modal__icon-close"
                onClick={handleCloseSettings}
                aria-label="Close game menu"
              >
                ×
              </button>
              <h2 id="game-settings-title">Settings</h2>
              <button
                type="button"
                className="modal__section-dropdown"
                onClick={() => setIsUxSettingsOpen((current) => !current)}
                aria-expanded={isUxSettingsOpen}
                aria-controls="game-menu-ux-settings"
              >
                <span className="modal__section-dropdown-label">
                  Sounds & Display
                </span>
                <span aria-hidden="true">{isUxSettingsOpen ? "▾" : "▸"}</span>
              </button>
              <div
                id="game-menu-ux-settings"
                className={`modal__collapsible ${isUxSettingsOpen ? "modal__collapsible--open" : ""}`}
                aria-hidden={!isUxSettingsOpen}
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
                  {/* DO NOT REMOVE LET IT SNOW BUTTON IS TO BE COMMENTED OUT UNTIL WINTER */}
                  {/* <div className="modal__option">
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
                </div> */}
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
                onClick={() =>
                  setIsAccessibilitySettingsOpen((current) => !current)
                }
                aria-expanded={isAccessibilitySettingsOpen}
                aria-controls="game-menu-accessibility-settings"
              >
                <span className="modal__section-dropdown-label">
                  Accessibility
                </span>
                <span aria-hidden="true">
                  {isAccessibilitySettingsOpen ? "▾" : "▸"}
                </span>
              </button>
              <div
                id="game-menu-accessibility-settings"
                className={`modal__collapsible ${isAccessibilitySettingsOpen ? "modal__collapsible--open" : ""}`}
                aria-hidden={!isAccessibilitySettingsOpen}
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

              {isCurrentTurn && isGameActive ? (
                <div className="modal__option">
                  <button
                    type="button"
                    className="form-button-full-width"
                    onClick={handleResyncTurn}
                    disabled={isSubmittingAction}
                  >
                    {actionSyncError ? "Retry sync" : "Resync turn"}
                  </button>
                  <p className="modal__option-help">
                    Sync your turn state if an action appears stuck.
                  </p>
                </div>
              ) : null}
              <div className="modal__actions">
                {isLocalPlayer ? (
                  <button
                    className="form-button-full-width"
                    type="button"
                    onClick={handleOpenLeaveGameModal}
                  >
                    Leave game
                  </button>
                ) : null}
                <button
                  className="form-button-full-width"
                  type="button"
                  onClick={() => router.push("/")}
                >
                  Main Menu
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {isGameComplete && isFinalScoresOpen ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <h2 className="sage-eyebrow-text">Game over</h2>
              <div className="bonus-announcement-wrap">
                {revealedBonusCount < endGameBonuses.length ? (
                  <div
                    className="bonus-announcement"
                    key={endGameBonuses[revealedBonusCount]?.id}
                  >
                    <p className="bonus-announcement__title">
                      {endGameBonuses[revealedBonusCount]?.title}
                    </p>
                    <p className="bonus-announcement__winner">
                      {endGameBonuses[revealedBonusCount]?.winnerName}
                    </p>
                    <p className="bonus-announcement__points">
                      Bonus: -5 points
                    </p>
                  </div>
                ) : null}

                <ol className="bonus-results-list">
                  {endGameBonuses.slice(0, revealedBonusCount).map((bonus) => (
                    <li key={bonus.id} className="bonus-results-item">
                      <span>{bonus.title}</span>
                      <span>{bonus.winnerName} (-5)</span>
                    </li>
                  ))}
                </ol>
              </div>
              {revealedBonusCount >= endGameBonuses.length ? (
                <div>
                  {earnedXpBreakdown ? (
                    <div className="modal__option">
                      <div className="modal__option-label">
                        <span>Your XP</span>
                      </div>
                      <p className="modal__option-help">
                        Base XP: {earnedXpBreakdown.baseXp}
                      </p>
                      <p className="modal__option-help">
                        Placement XP: {earnedXpBreakdown.placementBaseXp} ×{" "}
                        {earnedXpBreakdown.playerCountMultiplier.toFixed(2)} ={" "}
                        {earnedXpBreakdown.placementXp}{" "}
                        <span style={{ textTransform: "capitalize" }}>
                          ({earnedXpBreakdown.placementBand})
                        </span>
                      </p>
                      <p className="modal__option-help">
                        Cleared-points XP: {earnedXpBreakdown.clearedRowXp}
                      </p>
                      <p className="modal__option-help">
                        Total XP gained: {earnedXpBreakdown.totalXp}
                      </p>
                      {localPlayerExperiencePreview ? (
                        <>
                          <p className="modal__option-help">
                            {localPlayerExperiencePreview.leveledUp
                              ? `Level up! ${localPlayerExperiencePreview.previousLevel} → ${localPlayerExperiencePreview.currentLevel}.`
                              : `Level ${localPlayerExperiencePreview.currentLevel}.`}{" "}
                            {localPlayerExperiencePreview.xpGainedTowardCurrentLevel} /{" "}
                            {
                              localPlayerExperiencePreview.xpRequiredForCurrentLevel
                            }{" "}
                            XP this level ·{" "}
                            {localPlayerExperiencePreview.xpRemainingToNextLevel}{" "}
                            XP until level{" "}
                            {localPlayerExperiencePreview.nextLevel}.
                          </p>
                          {unlockedRewardMessage ? (
                            <p className="modal__option-help">
                              {unlockedRewardMessage}.
                            </p>
                          ) : null}
                          {!unlockedRewardMessage &&
                          localPlayerExperiencePreview.showRewardPreview ? (
                            <p className="modal__option-help">
                              Level {localPlayerExperiencePreview.nextLevel}{" "}
                              unlocks the next reward.
                            </p>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="game-complete-table-wrap">
                    <table className="game-complete-table">
                      <thead>
                        <tr>
                          <th scope="col">Rank</th>
                          <th scope="col">Player</th>
                          <th scope="col">Score</th>
                          <th scope="col">Time</th>
                          <th scope="col">Avg discarded card</th>
                          <th scope="col">Avg revealed card</th>
                          <th scope="col">Cleared (rows + columns)</th>
                          <th scope="col">Items</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finalStatsRows.map((player) => (
                          <tr key={player.id}>
                            <td>{player.rank}</td>
                            <td>{player.displayName}</td>
                            <td>{player.totalScore}</td>
                            <td>{player.totalTurnLength}</td>
                            <td>{player.averageDiscardedCardValue}</td>
                            <td>{player.averageRevealedCardValue}</td>
                            <td>{player.pointsClearedFromRows}</td>
                            <td>{player.itemCardsDrawn}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
              <div className="modal__actions">
                <button
                  type="button"
                  className="form-button-full-width"
                  onClick={() => router.push("/")}
                >
                  Back to main menu
                </button>
                <button
                  type="button"
                  className="form-button-full-width"
                  onClick={() => setIsFinalScoresOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {game?.status === "round-complete" ? (
          <section className="game-results">
            <h2 className="sage-eyebrow-text">Round totals</h2>
            <ol className="round-score-list">
              {sortedScores.map((player) => (
                <li key={player.id} className="round-score-item">
                  <span className="round-score-item__name">
                    {player.displayName}
                    {player.roundSpiked ? (
                      <span className="round-score-item__tag">spiked</span>
                    ) : null}
                    {player.isReady ? <span aria-label="Ready"> ✓</span> : null}
                  </span>
                  <span className="round-score-item__score">
                    {player.roundScore} ({player.totalScore})
                  </span>
                </li>
              ))}
            </ol>
            <div className="game-results__actions">
              {isLocalPlayer ? (
                <div className="game-results__primary-actions">
                  {isLocalPlayerReady ? (
                    <p className="notice game-results__ready-slot">
                      You are ready for the next round.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="form-button-full-width game-results__ready-slot"
                      onClick={handleReadyForNextRound}
                    >
                      Ready up
                    </button>
                  )}
                  <button
                    type="button"
                    className="form-button-full-width game-results__leave-button"
                    onClick={handleOpenLeaveGameModal}
                  >
                    Leave game
                  </button>
                </div>
              ) : null}
              {isHost ? (
                <button
                  type="button"
                  className="form-button-full-width"
                  onClick={handleStartNextRound}
                  disabled={isStartingNextRound || !allPlayersReady}
                >
                  {isStartingNextRound
                    ? "Starting next round..."
                    : "Start next round"}
                </button>
              ) : (
                <p className="notice">
                  {allPlayersReady
                    ? "Waiting for the host to start the next round."
                    : "Waiting for everyone to ready up."}
                </p>
              )}
            </div>
          </section>
        ) : null}

        {isGameComplete && finalRoundScores.length ? (
          <section className="game-results">
            <h2 className="sage-eyebrow-text">Final round totals</h2>
            <ol className="round-score-list">
              {finalRoundScores.map((player) => (
                <li key={player.id} className="round-score-item">
                  <span className="round-score-item__name">
                    {player.displayName}
                    {player.roundSpiked ? (
                      <span className="round-score-item__tag">spiked</span>
                    ) : null}
                  </span>
                  <span className="round-score-item__score">
                    {player.roundScore}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {isLeaveGameModalOpen ? (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-game-modal-title"
            onClick={handleCloseLeaveGameModal}
          >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="modal__icon-close"
                onClick={handleCloseLeaveGameModal}
                aria-label="Close leave game confirmation"
              >
                ×
              </button>
              <h2 id="leave-game-modal-title">Leave game</h2>
              <p>
                Are you sure you want to leave the game? Once you leave you
                cannot rejoin.
              </p>
              <div className="modal__actions">
                <button
                  type="button"
                  className="form-button-full-width game-results__leave-button"
                  onClick={handleConfirmLeaveGame}
                >
                  Confirm leave
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showDockedPiles && game?.status !== "round-complete" ? (
          <div className="game-piles game-piles--dock">
            <div className="game-pile">
              <h6>Deck</h6>
              {renderDrawPile()}
              <div className="card-tags">
                <span className="last-turn-summary">{lastTurnSummary}</span>
              </div>
            </div>
            <div className="game-pile">
              <h6>Discard</h6>
              {renderDiscardPile()}
            </div>
            <div className="game-pile">
              <h6>Selected card</h6>
              <div>
                {showSelectedCard ? (
                  <div
                    key={`selected-card-dock-${selectedCardAnimationId}`}
                    className={`card card--discard-pile card--selected-animated${getCardStyleClass(selectedCardValue)}`}
                    style={selectedCardMaskStyle}
                    aria-label="Selected card"
                  >
                    {isItemCard(selectedCardValue) ? (
                      renderItemContent(selectedCardValue.code)
                    ) : (
                      <span className="card__value">{selectedCardLabel}</span>
                    )}
                  </div>
                ) : (
                  <div
                    className="card card--empty-selected"
                    aria-label="No selected card"
                  >
                    —
                  </div>
                )}
                <div className="card-tags">
                  <span className="card-draw-source">
                    {selectedCardOwnerLabel}
                  </span>
                  <span className="card-draw-source">
                    {selectedCardSourceLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <section className="game-board">
          {(actionSyncError || error) && (
            <div className="notice" role="status" aria-live="polite">
              {actionSyncError ? <p>{actionSyncError}</p> : null}
              {error ? <p>{error}</p> : null}
            </div>
          )}
          <div className="game-piles" ref={gamePilesRef}>
            <div className="game-pile">
              <h6>Deck</h6>
              {renderDrawPile()}
              <div className="card-tags">
                <span className="last-turn-summary">{lastTurnSummary}</span>
              </div>
            </div>
            <div className="game-pile">
              <h6>Discard</h6>
              {renderDiscardPile()}
            </div>
            <div className="game-pile">
              <h6>Selected card</h6>
              <>
                {showSelectedCard ? (
                  <div
                    key={`selected-card-dock-${selectedCardAnimationId}`}
                    className={`card card--discard-pile card--selected-animated${getCardStyleClass(selectedCardValue)}`}
                    style={selectedCardMaskStyle}
                    aria-label="Selected card"
                  >
                    {isItemCard(selectedCardValue) ? (
                      renderItemContent(selectedCardValue.code)
                    ) : (
                      <span className="card__value">{selectedCardLabel}</span>
                    )}
                  </div>
                ) : (
                  <div
                    className="card card--empty-selected"
                    aria-label="No selected card"
                  >
                    —
                  </div>
                )}
                <div className="card-tags">
                  <span className="card-draw-source">
                    {selectedCardOwnerLabel}
                  </span>
                  <span className="card-draw-source">
                    {selectedCardSourceLabel}
                  </span>
                </div>
              </>
            </div>
          </div>
          {isResolvingItem && itemCode ? (
            <div className="item-panel" role="status" aria-live="polite">
              <div className="item-panel__summary">
                <div>
                  <p className="item-panel__title">{itemName}</p>
                  <p className="item-panel__description">
                    {itemDescriptions[itemCode]}
                  </p>
                </div>
              </div>
              {itemTargetsNeeded > 0 ? (
                <div className="item-panel__targets">
                  <p className="item-panel__instruction">
                    {itemTargetInstruction}
                  </p>
                  <div className="item-panel__target-list">
                    {itemTargets.map((target, index) => (
                      <div
                        key={`${target.playerId}-${isCardTarget(target) ? target.index : "player"}`}
                        className="item-panel__target-pill"
                      >
                        <span className="item-panel__target-order">
                          {index + 1}
                        </span>
                        <span>{getItemTargetLabel(target)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="item-panel__instruction">Ready.</p>
              )}
              {itemCode === "C" ? (
                <div className="item-panel__values">
                  <p className="item-panel__instruction">
                    Choose a wild value.
                  </p>
                  <div className="item-value-grid">
                    {itemValueOptions.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`item-value-button${
                          itemValue === value
                            ? " item-value-button--active"
                            : ""
                        }`}
                        onClick={() => setItemValue(value)}
                        disabled={itemTargets.length === 0}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {isCrossPlayerSwap ? (
                <p className="item-panel__warning">
                  Cross-player swaps require confirmation before applying.
                </p>
              ) : null}
              <div className="item-panel__actions">
                <button
                  type="button"
                  className="item-panel__action item-panel__action--primary"
                  onClick={() => handleUseItem()}
                  disabled={!canUseItem || isSubmittingAction}
                >
                  Use item
                </button>
                {itemTargets.length > 0 ? (
                  <button
                    type="button"
                    className="item-panel__action item-panel__action--ghost"
                    onClick={handleResetItemSelection}
                    disabled={isSubmittingAction}
                  >
                    Clear selection
                  </button>
                ) : null}
                {canDiscardItem ? (
                  <button
                    type="button"
                    className="item-panel__action item-panel__action--ghost"
                    onClick={handleDiscardItem}
                    disabled={isSubmittingAction}
                  >
                    Discard spike to reveal
                  </button>
                ) : null}
              </div>
            </div>
          ) : isItemDrawnByOtherPlayer && itemCode ? (
            <div className="item-panel" role="status" aria-live="polite">
              <div className="item-panel__summary">
                <div>
                  <span className="player-item-panel">
                    {itemOwnerName} drew
                  </span>
                </div>
                <div>
                  <p className="item-panel__title">{itemName}</p>
                  <p className="item-panel__description">
                    {itemDescriptions[itemCode]}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="player-grids">
            <div className="player-grids__list" ref={playerListContainerRef}>
              {displayPlayers.length ? (
                displayPlayers.map((player) => {
                  const isActivePlayer = player.id === game?.currentPlayerId;
                  const isLocalPlayer = player.id === uid;
                  return (
                    <PlayerGrid
                      key={player.id}
                      ref={(element) => {
                        playerGridRefs.current[player.id] = element;
                      }}
                      playerId={player.id}
                      label={`${player.displayName}${player.isReady ? " ✓" : ""}`}
                      localBadgeLabel={isLocalPlayer ? "YOU" : null}
                      size={isLocalPlayer ? "main" : "mini"}
                      isActive={isActivePlayer}
                      isLocal={isLocalPlayer}
                      grid={player.grid}
                      revealed={player.revealed}
                      mistTurnsRemaining={player.mistTurnsRemaining}
                      onCardSelect={
                        isLocalPlayer && canSelectGridCard
                          ? handleSelectGridCard
                          : undefined
                      }
                      activeActionIndex={
                        isLocalPlayer ? activeActionIndex : null
                      }
                      onReplace={
                        isLocalPlayer && showDrawActions
                          ? handleReplace
                          : undefined
                      }
                      onReveal={
                        isLocalPlayer && showDrawActions && !isSprinting
                          ? handleReveal
                          : undefined
                      }
                      onCancel={
                        isLocalPlayer && showDrawActions
                          ? handleCancelMenu
                          : undefined
                      }
                      revealSelectionActive={
                        isLocalPlayer &&
                        (isItemRevealPending || isRevealRecoveryActive) &&
                        !isSprinting
                      }
                      disableActionControls={
                        isLocalPlayer && isSubmittingAction
                      }
                      onPlayerSelect={undefined}
                      isPlayerSelected={false}
                      itemSelection={
                        isLocalPlayer &&
                        isCurrentTurn &&
                        itemCardSelectionActive
                          ? {
                              active: true,
                              targets: itemCardTargets,
                              onSelect: handleItemTargetSelect,
                            }
                          : undefined
                      }
                      runningTotal={player.totalScore ?? 0}
                    />
                  );
                })
              ) : (
                <p>No players yet.</p>
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
