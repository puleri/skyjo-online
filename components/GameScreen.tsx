"use client";

import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PlayerGrid from "./PlayerGrid";
import {
  discardPendingDraw,
  drawFromDeck,
  drawFromDiscard,
  revealAfterDiscard,
  selectDiscard,
  startNextRound,
  swapPendingDraw,
} from "../lib/gameActions";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

type GameScreenProps = {
  gameId: string;
};

type GameMeta = {
  status: string;
  currentPlayerId: string | null;
  activePlayerOrder: string[];
  deck: number[];
  discard: number[];
  hostId: string | null;
  roundNumber: number;
  turnPhase: string;
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
  grid?: Array<number | null>;
  revealed?: boolean[];
  pendingDraw?: number | null;
  pendingDrawSource?: "deck" | "discard" | null;
  totalScore?: number;
};

export default function GameScreen({ gameId }: GameScreenProps) {
  const router = useRouter();
  const firstTimeTipsStorageKey = "skyjo-first-time-tips";
  const drawTipMessage = "Click a card on your grid to either reveal or replace!";
  const discardTipMessage = "Select a card on your grid to swap with the discard pile.";
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
  const [showDockedPiles, setShowDockedPiles] = useState(false);
  const [spectators, setSpectators] = useState<Array<{ id: string; displayName: string }>>([]);
  const endingAnnouncementRef = useRef<string | null>(null);
  const gamePilesRef = useRef<HTMLDivElement | null>(null);
  const [isSpectatorModalOpen, setIsSpectatorModalOpen] = useState(false);
  const [isFinalTurnOverlayOpen, setIsFinalTurnOverlayOpen] = useState(false);
  const [dismissedFinalTurnForEndingPlayerId, setDismissedFinalTurnForEndingPlayerId] =
    useState<string | null>(null);

  const getCardValueClass = (value: number) => {
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
          deck: Array.isArray(data.deck) ? (data.deck as number[]) : [],
          discard: Array.isArray(data.discard) ? (data.discard as number[]) : [],
          hostId: (data.hostId as string | null | undefined) ?? null,
          roundNumber: (data.roundNumber as number | undefined) ?? 1,
          turnPhase: (data.turnPhase as string | undefined) ?? "choose-draw",
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
            grid: Array.isArray(data.grid) ? (data.grid as Array<number | null>) : undefined,
            revealed: Array.isArray(data.revealed) ? (data.revealed as boolean[]) : undefined,
            pendingDraw: (data.pendingDraw as number | null | undefined) ?? null,
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
  const isCurrentTurn = Boolean(uid && game?.currentPlayerId && uid === game.currentPlayerId);
  const isHost = Boolean(uid && game?.hostId && uid === game.hostId);
  const isRoundComplete = game?.status === "round-complete";
  const isGameComplete = game?.status === "game-complete";
  const isGameActive = game?.status === "playing";
  const isLocalPlayer = Boolean(uid && players.some((player) => player.id === uid));
  const selectedPlayer = useMemo(
    () => orderedPlayers.find((player) => typeof player.pendingDraw === "number") ?? null,
    [orderedPlayers]
  );
  const selectedDiscardPlayer = useMemo(
    () =>
      game?.selectedDiscardPlayerId
        ? orderedPlayers.find((player) => player.id === game.selectedDiscardPlayerId) ?? null
        : null,
    [game?.selectedDiscardPlayerId, orderedPlayers]
  );
  const discardSelectedCard =
    selectedDiscardPlayer && typeof topDiscard === "number" ? topDiscard : null;
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
  const discardSelectionActive =
    Boolean(game?.selectedDiscardPlayerId) && game?.selectedDiscardPlayerId === uid;
  const canDrawFromDeck =
    isCurrentTurn &&
    isGameActive &&
    game?.turnPhase === "choose-draw" &&
    typeof currentPlayer?.pendingDraw !== "number" &&
    !discardSelectionActive &&
    (game?.deck.length ?? 0) > 0;
  const canSelectDiscardTarget =
    isCurrentTurn &&
    isGameActive &&
    game?.turnPhase === "choose-draw" &&
    typeof currentPlayer?.pendingDraw !== "number" &&
    (game?.discard.length ?? 0) > 0;
  const showDrawnCard = isCurrentTurn && typeof currentPlayer?.pendingDraw === "number";
  const showSelectedCard =
    typeof selectedPlayer?.pendingDraw === "number" || discardSelectedCard !== null;
  const selectedCardValue = selectedPlayer?.pendingDraw ?? discardSelectedCard;
  const canSelectGridCard = isGameActive && (showDrawnCard || discardSelectionActive);
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
          <img className="eye-icon" src="/eye-icon.svg"/>
          <span className="spectator-count__value">{spectatorCount}</span>
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
            <div className="modal__actions">
              <button type="button" onClick={() => router.push("/")}>
                Back to main menu
              </button>
              <button type="button" onClick={() => setIsSettingsOpen(false)}>
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
            {isHost ? (
              <button
                type="button"
                className="form-button-full-width"
                onClick={handleStartNextRound}
                disabled={isStartingNextRound}
              >
                {isStartingNextRound ? "Starting next round..." : "Start next round"}
              </button>
            ) : (
              <p className="notice">Waiting for the host to start the next round.</p>
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
              <img
                className="card-back-image"
                src="/images/skyjo-cardback.png"
                alt="Skyjo card back"
              />
            </button>
            <div className="card-tags">
              <span className="last-turn-summary">{lastTurnSummary}</span>
            </div>
          </div>
          <div className="game-pile">
            <h6>Discard</h6>
            {typeof topDiscard === "number" ? (
              <button
                type="button"
                className={`card card--discard-pile${getCardValueClass(topDiscard)}`}
                aria-label="Discard pile"
                onClick={handleSelectDiscard}
                disabled={!canSelectDiscardTarget}
              >
                <span className="card__value">{topDiscard}</span>
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
                  className={`card card--discard-pile${
                    typeof selectedCardValue === "number"
                      ? getCardValueClass(selectedCardValue)
                      : ""
                  }`}
                  aria-label="Selected card"
                >
                  <span className="card__value">{selectedCardValue}</span>
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
              <img
                className="card-back-image"
                src="/images/skyjo-cardback.png"
                alt="Skyjo card back"
              />
            </button>
            <div className="card-tags">
              <span className="last-turn-summary">{lastTurnSummary}</span>
            </div>
          </div>
          <div className="game-pile">
            <h6>Discard</h6>
            {typeof topDiscard === "number" ? (
              <button
                type="button"
                className={`card card--discard-pile${getCardValueClass(topDiscard)}`}
                aria-label="Discard pile"
                onClick={handleSelectDiscard}
                disabled={!canSelectDiscardTarget}
              >
                <span className="card__value">{topDiscard}</span>
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
                  className={`card card--discard-pile${
                    typeof selectedCardValue === "number"
                      ? getCardValueClass(selectedCardValue)
                      : ""
                  }`}
                  aria-label="Selected card"
                >
                  <span className="card__value">{selectedCardValue}</span>
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

        <div className="player-grids">
          <div className="player-grids__list">
            {displayPlayers.length ? (
              displayPlayers.map((player) => {
                const isActivePlayer = player.id === game?.currentPlayerId;
                const isLocalPlayer = player.id === uid;
                return (
                  <PlayerGrid
                    key={player.id}
                    label={`${player.displayName}${isLocalPlayer ? " (you)" : ""}${
                      player.isReady ? " (ready)" : ""
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
                    onReplace={isLocalPlayer && showDrawnCard ? handleReplace : undefined}
                    onReveal={isLocalPlayer && showDrawnCard ? handleReveal : undefined}
                    onCancel={isLocalPlayer && showDrawnCard ? handleCancelMenu : undefined}
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
            <button
            type="button"
            className="icon-button"
            aria-label="Open settings"
            onClick={() => setIsSettingsOpen(true)}
          >
            <span aria-hidden="true">⚙️</span>
          </button>
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
    </main>
  );
}
