"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PlayerGrid from "./PlayerGrid";
import {
  discardPendingDraw,
  discardItemForReveal,
  drawFromDeck,
  drawFromDiscard,
  revealAfterDiscard,
  readyForNextRound,
  selectDiscard,
  startNextRound,
  swapPendingDraw,
  useItemCard,
} from "../lib/gameActions";
import { useAnonymousAuth } from "../lib/auth";
import type { Card, ItemCard } from "../lib/game/deck";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

type GameScreenProps = {
  gameId: string;
};

type GameMeta = {
  status: string;
  currentPlayerId: string | null;
  activePlayerOrder: string[];
  deck: Card[];
  discard: Card[];
  hostId: string | null;
  roundNumber: number;
  turnPhase: string;
  spikeMode: boolean;
  endingPlayerId: string | null;
  finalTurnRemainingIds: string[] | null;
  selectedDiscardPlayerId: string | null;
  roundScores?: Record<string, number>;
  lastTurnPlayerId?: string | null;
  lastTurnAction?: string | null;
};

type GamePlayer = {
  id: string;
  displayName: string;
  isReady: boolean;
  grid?: Array<Card | null>;
  revealed?: boolean[];
  pendingDraw?: Card | null;
  pendingDrawSource?: "deck" | "discard" | null;
  totalScore?: number;
};

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

export default function GameScreen({ gameId }: GameScreenProps) {
  const router = useRouter();
  const firstTimeTipsStorageKey = "skyjo-first-time-tips";
  const darkModeStorageKey = "skyjo-dark-mode";
  const drawTipMessage = "Click a card on your grid to either reveal or replace!";
  const discardTipMessage = "Select a card on your grid to swap with the discard pile.";
  const itemRevealTipMessage = "Select an unrevealed card to reveal.";
  const firebaseReady = isFirebaseConfigured;
  const { uid, error: authError } = useAnonymousAuth();
  const [game, setGame] = useState<GameMeta | null>(null);
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activeActionIndex, setActiveActionIndex] = useState<number | null>(null);
  const [isStartingNextRound, setIsStartingNextRound] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showFirstTimeTips, setShowFirstTimeTips] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(darkModeStorageKey) === "true";
  });
  const [showDockedPiles, setShowDockedPiles] = useState(false);
  const [spectators, setSpectators] = useState<Array<{ id: string; displayName: string }>>([]);
  const endingAnnouncementRef = useRef<string | null>(null);
  const gamePilesRef = useRef<HTMLDivElement | null>(null);
  const [isSpectatorModalOpen, setIsSpectatorModalOpen] = useState(false);
  const [isFinalTurnOverlayOpen, setIsFinalTurnOverlayOpen] = useState(false);
  const [dismissedFinalTurnForEndingPlayerId, setDismissedFinalTurnForEndingPlayerId] =
    useState<string | null>(null);
  const [isColdOverlayOpen, setIsColdOverlayOpen] = useState(false);
  const [dismissedColdOverlayRound, setDismissedColdOverlayRound] = useState<number | null>(null);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const leaderboardUpdateRef = useRef(new Set<string>());
  const [itemTargets, setItemTargets] = useState<ItemTarget[]>([]);
  const [itemValue, setItemValue] = useState<number | null>(null);
  const [isSwapConfirmOpen, setIsSwapConfirmOpen] = useState(false);
  const [pendingItemReveal, setPendingItemReveal] = useState(false);
  const pendingDrawRef = useRef<Map<string, Card | null>>(new Map());
  const hasInitializedDrawSoundRef = useRef(false);

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
    return " card--value-max";
  };

  const isItemCard = (value: Card | null | undefined): value is ItemCard =>
    Boolean(value) && typeof value === "object" && value.kind === "item";

  const getCardLabel = (value: Card | null | undefined) => {
    if (typeof value === "number") {
      return value;
    }
    if (isItemCard(value)) {
      return value.code;
    }
    return "—";
  };

  const getCardStyleClass = (value: Card | null | undefined) => {
    if (isItemCard(value)) {
      return ` card--item card--item-${value.code}`;
    }
    return getCardValueClass(value);
  };

  const getDrawSoundPath = (value: number) => {
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
    return null;
  };

  const playDrawSound = (value: number) => {
    const soundPath = getDrawSoundPath(value);
    if (!soundPath || typeof window === "undefined") {
      return;
    }
    const audio = new Audio(soundPath);
    audio.play().catch(() => undefined);
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
          endingPlayerId: (data.endingPlayerId as string | null | undefined) ?? null,
          finalTurnRemainingIds: Array.isArray(data.finalTurnRemainingIds)
            ? (data.finalTurnRemainingIds as string[])
            : null,
          selectedDiscardPlayerId:
            (data.selectedDiscardPlayerId as string | null | undefined) ?? null,
          roundScores: (data.roundScores as Record<string, number> | undefined) ?? undefined,
          lastTurnPlayerId: (data.lastTurnPlayerId as string | null | undefined) ?? null,
          lastTurnAction: (data.lastTurnAction as string | null | undefined) ?? null,
        });
      },
      (err) => {
        setError(err.message);
      }
    );

    return () => unsubscribe();
  }, [firebaseReady, gameId]);

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
        typeof nextPending === "number" &&
        nextPending !== previousPending
      ) {
        playDrawSound(nextPending);
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
      },
      (err) => {
        setError(err.message);
      }
    );

    return () => unsubscribe();
  }, [firebaseReady]);

  useEffect(() => {
    const storedPreference = window.localStorage.getItem(firstTimeTipsStorageKey);
    if (storedPreference === null) {
      return;
    }
    setShowFirstTimeTips(storedPreference === "true");
  }, []);

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
            displayName: (data.displayName as string | undefined) ?? "Anonymous player",
            isReady: Boolean(data.isReady),
            grid: Array.isArray(data.grid) ? (data.grid as Array<Card | null>) : undefined,
            revealed: Array.isArray(data.revealed) ? (data.revealed as boolean[]) : undefined,
            pendingDraw: (data.pendingDraw as Card | null | undefined) ?? null,
            pendingDrawSource:
              (data.pendingDrawSource as "deck" | "discard" | null | undefined) ?? null,
            totalScore: (data.totalScore as number | undefined) ?? undefined,
          };
        });
        setPlayers(nextPlayers);
      },
      (err) => {
        setError(err.message);
      }
    );

    return () => unsubscribe();
  }, [firebaseReady, gameId]);

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
            displayName: (doc.data().displayName as string | undefined) ?? "Anonymous spectator",
          }))
        );
      },
      (err) => {
        setError(err.message);
      }
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
    const remaining = players.filter((player) => !game.activePlayerOrder.includes(player.id));
    return [...ordered, ...remaining];
  }, [game?.activePlayerOrder, players]);

  const getPlayerLabel = (playerId: string) =>
    orderedPlayers.find((player) => player.id === playerId)?.displayName ?? "Player";

  const displayPlayers = useMemo(() => {
    if (!uid) {
      return orderedPlayers;
    }
    const localPlayerIndex = orderedPlayers.findIndex((player) => player.id === uid);
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
        ? orderedPlayers.find((player) => player.id === game.currentPlayerId) ?? null
        : null,
    [game?.currentPlayerId, orderedPlayers]
  );

  const lastTurnSummary = useMemo(() => {
    if (!game || !game.lastTurnPlayerId || !game.lastTurnAction) {
      return "First turn of the game";
    }
    const lastPlayer = orderedPlayers.find((player) => player.id === game.lastTurnPlayerId);
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
      }))
      .sort((a, b) => a.roundScore - b.roundScore);
  }, [game?.roundScores, game?.status, orderedPlayers]);
  const runningTotals = useMemo(
    () =>
      orderedPlayers.map((player) => ({
        id: player.id,
        displayName: player.displayName,
        totalScore: player.totalScore ?? 0,
      })),
    [orderedPlayers]
  );
  const topDiscard =
    game?.discard && game.discard.length > 0 ? game.discard[game.discard.length - 1] : null;
  const hasCardValue = (value: Card | null | undefined): value is Card =>
    value !== null && value !== undefined;
  const hasDiscard = hasCardValue(topDiscard);
  const isCurrentTurn = Boolean(uid && game?.currentPlayerId && uid === game.currentPlayerId);
  const isHost = Boolean(uid && game?.hostId && uid === game.hostId);
  const isRoundComplete = game?.status === "round-complete";
  const isGameComplete = game?.status === "game-complete";
  const isGameActive = game?.status === "playing";
  const isLocalPlayer = Boolean(uid && players.some((player) => player.id === uid));
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
  const selectedPlayer = useMemo(
    () => orderedPlayers.find((player) => hasCardValue(player.pendingDraw)) ?? null,
    [orderedPlayers]
  );
  const selectedDiscardPlayer = useMemo(
    () =>
      game?.selectedDiscardPlayerId
        ? orderedPlayers.find((player) => player.id === game.selectedDiscardPlayerId) ?? null
        : null,
    [game?.selectedDiscardPlayerId, orderedPlayers]
  );
  const discardSelectedCard = selectedDiscardPlayer && hasDiscard ? topDiscard : null;
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
  const isPendingItem = isItemCard(pendingDrawnCard);
  const isResolvingItem =
    isCurrentTurn && isGameActive && game?.turnPhase === "resolve-item" && isPendingItem;
  const isItemRevealPending =
    pendingItemReveal && isCurrentTurn && isGameActive && game?.turnPhase === "resolve";
  const discardSelectionActive =
    Boolean(game?.selectedDiscardPlayerId) && game?.selectedDiscardPlayerId === uid;
  const canDrawFromDeck =
    isCurrentTurn &&
    isGameActive &&
    game?.turnPhase === "choose-draw" &&
    !hasCardValue(currentPlayer?.pendingDraw) &&
    !discardSelectionActive &&
    (game?.deck.length ?? 0) > 0;
  const canSelectDiscardTarget =
    isCurrentTurn &&
    isGameActive &&
    game?.turnPhase === "choose-draw" &&
    !hasCardValue(currentPlayer?.pendingDraw) &&
    (game?.discard.length ?? 0) > 0;
  const showDrawnCard = isCurrentTurn && hasCardValue(currentPlayer?.pendingDraw);
  const showSelectedCard = hasCardValue(selectedPlayer?.pendingDraw) || discardSelectedCard !== null;
  const selectedCardValue = selectedPlayer?.pendingDraw ?? discardSelectedCard;
  const selectedCardLabel = getCardLabel(selectedCardValue);
  const discardCardLabel = getCardLabel(topDiscard);
  const canSelectGridCard =
    isGameActive &&
    (showDrawnCard || discardSelectionActive || isItemRevealPending) &&
    !isResolvingItem;
  const itemValueOptions = useMemo(() => Array.from({ length: 15 }, (_, index) => index - 2), []);
  const pendingItem = isResolvingItem && isItemCard(pendingDrawnCard) ? pendingDrawnCard : null;
  const itemCode = pendingItem?.code ?? null;
  const itemTargetsNeeded =
    itemCode === "B" ? 0 : itemCode === "E" ? 2 : itemCode ? 1 : 0;
  const itemRequiresValue = itemCode === "C";
  const itemTargetsReady = itemTargets.length === itemTargetsNeeded;
  const itemValueReady = !itemRequiresValue || itemValue !== null;
  const canUseItem = Boolean(itemCode && itemTargetsReady && itemValueReady);
  const isCrossPlayerSwap =
    itemCode === "E" &&
    itemTargets.length === 2 &&
    itemTargets[0].playerId !== itemTargets[1].playerId;
  const showDrawActions = showDrawnCard && !isPendingItem;
  const itemSelectionActive = isResolvingItem && itemTargetsNeeded > 0;
  const canDiscardItem = isResolvingItem && Boolean(itemCode);
  const itemDescriptions: Record<string, string> = {
    A: "Pick any card on ANY board. Randomize it.",
    B: "Shuffle your grid.",
    C: "WILD CARD! Set any card to a ANY value.",
    D: "Freeze a player so they skip their next turn.",
    E: "Swap any two cards (confirm if across players).",
  };
  const isLocalFinalTurn =
    uid !== null &&
    Boolean(game?.endingPlayerId) &&
    game?.endingPlayerId !== uid &&
    game?.currentPlayerId === uid &&
    Boolean(game?.finalTurnRemainingIds?.includes(uid));
  const spectatorCount = useMemo(() => {
    if (!spectators.length) {
      return 0;
    }
    const playerIds = new Set(players.map((player) => player.id));
    return spectators.filter((spectator) => !playerIds.has(spectator.id)).length;
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
      players.find((player) => player.id === game.endingPlayerId)?.displayName ?? "A player"
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
    setToastMessage(`${endingPlayerName} revealed all cards. Everyone gets one final turn!`);
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

    if (dismissedFinalTurnForEndingPlayerId !== game.endingPlayerId && isLocalFinalTurn) {
      setIsFinalTurnOverlayOpen(true);
      return;
    }

    if (!isLocalFinalTurn) {
      setIsFinalTurnOverlayOpen(false);
    }
  }, [dismissedFinalTurnForEndingPlayerId, game?.endingPlayerId, isLocalFinalTurn]);

  const handleDismissFinalTurnOverlay = () => {
    if (game?.endingPlayerId) {
      setDismissedFinalTurnForEndingPlayerId(game.endingPlayerId);
    }
    setIsFinalTurnOverlayOpen(false);
  };

  useEffect(() => {
    if (!isRoundComplete) {
      setIsColdOverlayOpen(false);
      return;
    }

    if (!hasColdRoundScore || typeof game?.roundNumber !== "number") {
      setIsColdOverlayOpen(false);
      return;
    }

    if (dismissedColdOverlayRound !== game.roundNumber) {
      setIsColdOverlayOpen(true);
      return;
    }

    setIsColdOverlayOpen(false);
  }, [dismissedColdOverlayRound, game?.roundNumber, hasColdRoundScore, isRoundComplete]);

  const handleDismissColdOverlay = () => {
    if (typeof game?.roundNumber === "number") {
      setDismissedColdOverlayRound(game.roundNumber);
    }
    setIsColdOverlayOpen(false);
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

  useEffect(() => {
    if (!firebaseReady || !gameId || !isGameComplete || !finalScores.length) {
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
      const leaderboardQuery = query(leaderboardRef, orderBy("score", "asc"), limit(10));
      const leaderboardSnapshot = await getDocs(leaderboardQuery);
      const leaderboardScores = leaderboardSnapshot.docs
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
            },
            { merge: true }
          )
        )
      );
    };

    updateLeaderboard().catch((err: Error) => setError(err.message));
  }, [firebaseReady, finalScores, gameId, isGameComplete]);

  const getAccolade = (index: number) => {
    if (index === 0) {
      return "1st";
    }
    if (index === 1) {
      return "2nd";
    }
    if (index === 2) {
      return "3rd";
    }
    return null;
  };

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

    const resolvedName = window.localStorage.getItem("skyjo:username")?.trim();
    const touchSpectator = () =>
      setDoc(
        spectatorRef,
        {
          displayName: resolvedName || "Anonymous spectator",
          joinedAt: serverTimestamp(),
          lastSeen: serverTimestamp(),
        },
        { merge: true }
      ).catch((err: Error) => setError(err.message));

    touchSpectator();
    const heartbeat = window.setInterval(() => {
      setDoc(
        spectatorRef,
        {
          displayName: resolvedName || "Anonymous spectator",
          lastSeen: serverTimestamp(),
        },
        { merge: true }
      ).catch((err: Error) => setError(err.message));
    }, 60000);

    return () => {
      window.clearInterval(heartbeat);
      deleteDoc(spectatorRef).catch(() => undefined);
    };
  }, [firebaseReady, gameId, isLocalPlayer, uid]);

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

    setError(null);
    try {
      await drawFromDeck(gameId, uid);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  };

  const handleSelectGridCard = (index: number) => {
    if (!canSelectGridCard) {
      return;
    }
    if (isItemRevealPending) {
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

    setError(null);
    try {
      await drawFromDiscard(gameId, uid, targetIndex);
      setActiveActionIndex(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
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

    setError(null);
    try {
      await selectDiscard(gameId, uid);
      setActiveActionIndex(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
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

    setError(null);
    try {
      await swapPendingDraw(gameId, uid, index);
      setActiveActionIndex(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
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

    setError(null);
    try {
      await discardPendingDraw(gameId, uid);
      await revealAfterDiscard(gameId, uid, index);
      setActiveActionIndex(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
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
    if (!isItemRevealPending) {
      return;
    }
    if (currentPlayer?.revealed?.[index]) {
      setError("Choose an unrevealed card to reveal.");
      return;
    }

    setError(null);
    try {
      await revealAfterDiscard(gameId, uid, index);
      setPendingItemReveal(false);
      setActiveActionIndex(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  };

  const handleItemTargetSelect = (target: ItemTarget) => {
    if (!itemCode || !isResolvingItem || itemTargetsNeeded === 0) {
      return;
    }
    const isSameTarget = (left: ItemTarget, right: ItemTarget) =>
      left.playerId === right.playerId && left.index === right.index;
    setItemTargets((prev) => {
      let nextTargets: ItemTarget[] = [];
      if (itemTargetsNeeded === 1) {
        const existing = prev[0];
        nextTargets = existing && isSameTarget(existing, target) ? [] : [target];
      } else {
        if (prev.some((existing) => isSameTarget(existing, target))) {
          nextTargets = prev.filter((existing) => !isSameTarget(existing, target));
        } else if (prev.length < 2) {
          nextTargets = [...prev, target];
        } else {
          nextTargets = [target];
        }
      }
      if (itemCode === "C") {
        const previousTarget = prev[0];
        const nextTarget = nextTargets[0];
        if (!previousTarget || !nextTarget || !isSameTarget(previousTarget, nextTarget)) {
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

    setError(null);
    try {
      if (itemCode === "A") {
        await useItemCard(gameId, uid, { code: "A", target: itemTargets[0] });
      } else if (itemCode === "B") {
        await useItemCard(gameId, uid, { code: "B" });
      } else if (itemCode === "C") {
        await useItemCard(gameId, uid, {
          code: "C",
          target: itemTargets[0],
          value: itemValue ?? 0,
        });
      } else if (itemCode === "D") {
        await useItemCard(gameId, uid, {
          code: "D",
          target: itemTargets[0],
        });
      } else if (itemCode === "E") {
        await useItemCard(gameId, uid, {
          code: "E",
          first: itemTargets[0],
          second: itemTargets[1],
        });
      }
      handleResetItemSelection();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
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

    setError(null);
    try {
      await discardItemForReveal(gameId, uid);
      handleResetItemSelection();
      setPendingItemReveal(true);
      setActiveActionIndex(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  };

  const handleCancelMenu = () => {
    setActiveActionIndex(null);
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
    <main className={`container game-screen${isCurrentTurn ? " game-screen--current-turn " : ""}`}>
      <div className="spectator-count">
        <button
          type="button"
          className="spectator-count__button"
          aria-label={`Spectators: ${spectatorCount}`}
          aria-haspopup="dialog"
          onClick={() => setIsSpectatorModalOpen(true)}
        >
          <img className="eye-icon" src="/eye-icon.png"/>
          <span className="spectator-count__value">{spectatorCount}</span>
        </button>
        <button
          type="button"
          className="settings-button"
          aria-label="Open settings"
          onClick={() => setIsSettingsOpen(true)}
        >
          <img className="settings-icon" src="/settings-icon.png"/>
        </button>
      </div>
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
              <button className="form-button-full-width" type="button" onClick={() => setIsSpectatorModalOpen(false)}>
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
            <h2 id="leaderboard-title">Leaderboard</h2>
            <p>Lowest 10 scores of all time.</p>
            {leaderboardEntries.length ? (
              <ol className="leaderboard-list">
                {leaderboardEntries.map((entry, index) => (
                  <li key={entry.id} className="leaderboard-list__item">
                    <span className="leaderboard-list__rank">{index + 1}.</span>
                    <span className="leaderboard-list__name">{entry.displayName}</span>
                    <span className="leaderboard-list__score">{entry.score}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No scores yet. Finish a game to claim a spot!</p>
            )}
            <div className="modal__actions">
              <button className="form-button-full-width" type="button" onClick={() => setIsLeaderboardOpen(false)}>
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
              {itemTargets.map((target, index) => (
                <div key={`${target.playerId}-${target.index}`} className="item-panel__target-pill">
                  <span className="item-panel__target-order">{index + 1}</span>
                  <span>
                    {getPlayerLabel(target.playerId)} · Card {target.index + 1}
                  </span>
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
            <br/>
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
      {isSettingsOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-settings-title"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2 id="game-settings-title">Game menu</h2>
            <p>Manage your game settings.</p>
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
            <div className="modal__actions">
              <button className="form-button-full-width" type="button" onClick={() => router.push("/")}>
                Main Menu
              </button>
              <button className="form-button-full-width" type="button" onClick={() => setIsSettingsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isGameComplete ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2 className="sage-eyebrow-text">Game over</h2>
            <ol className="game-complete-list">
              {finalScores.map((player, index) => {
                const accolade = getAccolade(index);
                return (
                  <li key={player.id} className="game-complete-item">
                    <span>
                      {accolade ? (
                        <span className="game-complete-badge">{accolade}</span>
                      ) : null}
                      {player.displayName}
                    </span>
                    <span className="game-complete-score">{player.totalScore}</span>
                  </li>
                );
              })}
            </ol>
            <div className="modal__actions">
              <button type="button" className="form-button-full-width" onClick={() => router.push("/")}>
                Back to main menu
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {game?.status === "round-complete" ? (
        <section className="game-results">
          <h2 className="sage-eyebrow-text">Round totals</h2>
          <ol>
            {sortedScores.map((player) => (
              <li key={player.id} className="round-score-item">
                {player.displayName}: {player.roundScore}
              </li>
            ))}
          </ol>
          <div className="game-results__actions">
            <div className="game-results__ready">
              <h3 className="charcoal-eyebrow-text">Ready status</h3>
              <ol className="player-list">
                {orderedPlayers.map((player) => (
                  <li key={player.id} className="player-list-item">
                    {player.displayName}
                    {player.isReady ? " ✓" : ""}
                  </li>
                ))}
              </ol>
            </div>
            {isLocalPlayerReady ? (
              <p className="notice">You are ready for the next round.</p>
            ) : (
              <button
                type="button"
                className="form-button-full-width"
                onClick={handleReadyForNextRound}
              >
                Ready up
              </button>
            )}
            {isHost ? (
              <button
                type="button"
                className="form-button-full-width"
                onClick={handleStartNextRound}
                disabled={isStartingNextRound || !allPlayersReady}
              >
                {isStartingNextRound ? "Starting next round..." : "Start next round"}
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

      {showDockedPiles ? (
        <div className="game-piles game-piles--dock">
          <div className="game-pile">
            <h6>Deck</h6>
            <button
              type="button"
              className="card-back-button"
              aria-label="Draw pile (face down)"
              onClick={handleDrawFromDeck}
              disabled={!canDrawFromDeck}
            >
              <span className="card-back-image" aria-hidden="true" />
            </button>
            <div className="card-tags">
              <span className="last-turn-summary">{lastTurnSummary}</span>
            </div>
          </div>
          <div className="game-pile">
            <h6>Discard</h6>
            {hasDiscard ? (
              <button
                type="button"
                className={`card card--discard-pile${getCardStyleClass(topDiscard)}`}
                aria-label="Discard pile"
                onClick={handleSelectDiscard}
                disabled={!canSelectDiscardTarget}
              >
                <span className="card__value">{discardCardLabel}</span>
              </button>
            ) : (
              <div className="card card--discard" aria-label="Empty discard pile">
                —
              </div>
            )}
          </div>
          <div className="game-pile">
            <h6>Selected card</h6>
            <div>
              {showSelectedCard ? (
                <div
                  className={`card card--discard-pile${getCardStyleClass(selectedCardValue)}`}
                  aria-label="Selected card"
                >
                  <span className="card__value">{selectedCardLabel}</span>
                </div>
              ) : (
                <div className="card card--empty-selected" aria-label="No selected card">
                  —
                </div>
              )}
              <div className="card-tags">
                <span className="card-draw-source">{selectedCardOwnerLabel}</span>
                <span className="card-draw-source">{selectedCardSourceLabel}</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <section className="game-board">
        <div className="game-piles" ref={gamePilesRef}>
          <div className="game-pile">
            <h6>Deck</h6>
            <button
              type="button"
              className="card-back-button"
              aria-label="Draw pile (face down)"
              onClick={handleDrawFromDeck}
              disabled={!canDrawFromDeck}
            >
              <span className="card-back-image" aria-hidden="true" />
            </button>
            <div className="card-tags">
              <span className="last-turn-summary">{lastTurnSummary}</span>
            </div>
          </div>
          <div className="game-pile">
            <h6>Discard</h6>
            {hasDiscard ? (
              <button
                type="button"
                className={`card card--discard-pile${getCardStyleClass(topDiscard)}`}
                aria-label="Discard pile"
                onClick={handleSelectDiscard}
                disabled={!canSelectDiscardTarget}
              >
                <span className="card__value">{discardCardLabel}</span>
              </button>
            ) : (
              <div className="card card--discard" aria-label="Empty discard pile">
                —
              </div>
            )}
          </div>
          <div className="game-pile">
            <h6>Selected card</h6>
            <>
              {showSelectedCard ? (
                <div
                  className={`card card--discard-pile${getCardStyleClass(selectedCardValue)}`}
                  aria-label="Selected card"
                >
                  <span className="card__value">{selectedCardLabel}</span>
                </div>
              ) : (
                <div className="card card--empty-selected" aria-label="No selected card">
                  —
                </div>
              )}
              <div className="card-tags">
                <span className="card-draw-source">{selectedCardOwnerLabel}</span>
                <span className="card-draw-source">{selectedCardSourceLabel}</span>
              </div>
            </>
          </div>
        </div>
        {isResolvingItem && itemCode ? (
          <div className="item-panel" role="status" aria-live="polite">
            <div className="item-panel__summary">
              <div className={`item-panel__badge card card--item card--item-${itemCode}`}>
                <span className="card__value">{itemCode}</span>
              </div>
              <div>
                <p className="item-panel__title">Item {itemCode}</p>
                <p className="item-panel__description">{itemDescriptions[itemCode]}</p>
              </div>
            </div>
            {itemTargetsNeeded > 0 ? (
              <div className="item-panel__targets">
                <p className="item-panel__instruction">
                  {itemTargets.length === 0
                    ? itemTargetsNeeded === 1
                      ? "Select a target card."
                      : "Select two target cards."
                    : itemTargets.length < itemTargetsNeeded
                      ? "Select a second target."
                      : "Targets selected."}
                </p>
                <div className="item-panel__target-list">
                  {itemTargets.map((target, index) => (
                    <div
                      key={`${target.playerId}-${target.index}`}
                      className="item-panel__target-pill"
                    >
                      <span className="item-panel__target-order">{index + 1}</span>
                      <span>
                        {getPlayerLabel(target.playerId)} · Card {target.index + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="item-panel__instruction">Ready to use this item.</p>
            )}
            {itemCode === "C" ? (
              <div className="item-panel__values">
                <p className="item-panel__instruction">Choose a wild value.</p>
                <div className="item-value-grid">
                  {itemValueOptions.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`item-value-button${
                        itemValue === value ? " item-value-button--active" : ""
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
                disabled={!canUseItem}
              >
                Use item
              </button>
              {itemTargets.length > 0 ? (
                <button
                  type="button"
                  className="item-panel__action item-panel__action--ghost"
                  onClick={handleResetItemSelection}
                >
                  Clear selection
                </button>
              ) : null}
              {canDiscardItem ? (
                <button
                  type="button"
                  className="item-panel__action item-panel__action--ghost"
                  onClick={handleDiscardItem}
                >
                  Discard item to reveal
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="player-grids">
          <div className="player-grids__list">
            {displayPlayers.length ? (
              displayPlayers.map((player) => {
                const isActivePlayer = player.id === game?.currentPlayerId;
                const isLocalPlayer = player.id === uid;
                return (
                  <PlayerGrid
                    key={player.id}
                    playerId={player.id}
                    label={`${player.displayName}${isLocalPlayer ? " (you)" : ""}${
                      player.isReady ? " ✓" : ""
                    }`}
                    size={isLocalPlayer ? "main" : "mini"}
                    isActive={isActivePlayer}
                    isLocal={isLocalPlayer}
                    grid={player.grid}
                    revealed={player.revealed}
                    onCardSelect={
                      isLocalPlayer && canSelectGridCard ? handleSelectGridCard : undefined
                    }
                    activeActionIndex={isLocalPlayer ? activeActionIndex : null}
                    onReplace={isLocalPlayer && showDrawActions ? handleReplace : undefined}
                    onReveal={isLocalPlayer && showDrawActions ? handleReveal : undefined}
                    onCancel={isLocalPlayer && showDrawActions ? handleCancelMenu : undefined}
                    revealSelectionActive={isLocalPlayer && isItemRevealPending}
                    itemSelection={
                      isCurrentTurn && itemSelectionActive
                        ? {
                            active: true,
                            targets: itemTargets,
                            onSelect: handleItemTargetSelect,
                          }
                        : undefined
                    }
                  />
                );
              })
            ) : (
              <p>No players yet.</p>
            )}
          </div>
        </div>
      </section>
      <section className="score-strip">
        <h2>Running totals</h2>
        <ul className="score-strip__list">
          {runningTotals.map((player) => (
            <li
              key={player.id}
              className={`score-strip__item${
                player.id === game?.currentPlayerId ? " score-strip__item--active" : ""
              }`}
            >
              <span className="score-strip__name">{player.displayName}</span>
              <span className="score-strip__score">{player.totalScore}</span>
            </li>
          ))}
        </ul>
              

      </section>
        <p className="legal-tiny">I do not own the rights to Skyjo; this is just a
          fan project made for learning purposes. If you enjoy this project, please
          consider buying the physical game online or from a game store near you</p>
    </main>
  );
}
