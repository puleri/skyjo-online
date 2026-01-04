"use client";

import { collection, doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PlayerGrid from "./PlayerGrid";
import {
  discardPendingDraw,
  drawFromDeck,
  drawFromDiscard,
  revealAfterDiscard,
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
  const firebaseReady = isFirebaseConfigured;
  const { uid, error: authError } = useAnonymousAuth();
  const [game, setGame] = useState<GameMeta | null>(null);
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activeActionIndex, setActiveActionIndex] = useState<number | null>(null);
  const [discardSelectionActive, setDiscardSelectionActive] = useState(false);
  const [isStartingNextRound, setIsStartingNextRound] = useState(false);
  const endingAnnouncementRef = useRef<string | null>(null);

  const getCardValueClass = (value: number) => {
    if (value < 0) {
      return " card--value-negative";
    }
    if (value === 0) {
      return " card--value-zero";
    }
    if (value <= 4) {
      return " card--value-low";
    }
    if (value <= 8) {
      return " card--value-mid";
    }
    if (value <= 10) {
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
        });
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

  const currentPlayer = useMemo(
    () =>
      game?.currentPlayerId
        ? orderedPlayers.find((player) => player.id === game.currentPlayerId) ?? null
        : null,
    [game?.currentPlayerId, orderedPlayers]
  );

  const sortedScores = useMemo(() => {
    if (game?.status !== "round-complete") {
      return [];
    }
    return [...orderedPlayers]
      .map((player) => ({
        id: player.id,
        displayName: player.displayName,
        totalScore: player.totalScore ?? 0,
      }))
      .sort((a, b) => a.totalScore - b.totalScore);
  }, [game?.status, orderedPlayers]);
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
  const selectedPlayer = useMemo(
    () => orderedPlayers.find((player) => typeof player.pendingDraw === "number") ?? null,
    [orderedPlayers]
  );
  const selectedCardOwnerLabel = selectedPlayer
    ? selectedPlayer.id === uid
      ? "You drew this card"
      : `${selectedPlayer.displayName} drew this card`
    : "Awaiting a drawn card";
  const selectedCardSourceLabel = selectedPlayer
    ? selectedPlayer.pendingDrawSource === "discard"
      ? "From discard pile"
      : "From draw pile"
    : "Awaiting draw source";
  const canDrawFromDeck =
    isCurrentTurn &&
    game?.turnPhase === "choose-draw" &&
    typeof currentPlayer?.pendingDraw !== "number" &&
    !discardSelectionActive &&
    (game?.deck.length ?? 0) > 0;
  const canSelectDiscardTarget =
    isCurrentTurn &&
    game?.turnPhase === "choose-draw" &&
    typeof currentPlayer?.pendingDraw !== "number" &&
    (game?.discard.length ?? 0) > 0;
  const showDrawnCard = isCurrentTurn && typeof currentPlayer?.pendingDraw === "number";
  const showSelectedCard = typeof selectedPlayer?.pendingDraw === "number";
  const canSelectGridCard = showDrawnCard || discardSelectionActive;

  const endingPlayerName = useMemo(() => {
    if (!game?.endingPlayerId) {
      return null;
    }
    return (
      players.find((player) => player.id === game.endingPlayerId)?.displayName ?? "A player"
    );
  }, [game?.endingPlayerId, players]);

  useEffect(() => {
    if (!showDrawnCard) {
      return;
    }

    setToastMessage("Click a card on your grid to either reveal or replace!");
    const timeout = window.setTimeout(() => {
      setToastMessage(null);
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [showDrawnCard]);

  useEffect(() => {
    if (!discardSelectionActive) {
      return;
    }

    setToastMessage("Select a card on your grid to swap with the discard pile.");
    const timeout = window.setTimeout(() => {
      setToastMessage(null);
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [discardSelectionActive]);

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
    if (!canSelectGridCard) {
      setActiveActionIndex(null);
    }
  }, [canSelectGridCard]);

  useEffect(() => {
    if (!canSelectDiscardTarget || showDrawnCard || !isCurrentTurn) {
      setDiscardSelectionActive(false);
    }
  }, [canSelectDiscardTarget, showDrawnCard, isCurrentTurn]);

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
      setDiscardSelectionActive(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    }
  };

  const handleSelectDiscard = () => {
    if (!canSelectDiscardTarget) {
      return;
    }
    setDiscardSelectionActive(true);
    setActiveActionIndex(null);
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
    <main className="game-screen">
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
      {toastMessage ? (
        <div className="toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      ) : null}
      <section className="game-header">
        <div className="game-header__actions">
          <button type="button" onClick={() => router.back()}>
            Back
          </button>
          <button type="button" onClick={() => router.push("/")}>
            Back to main menu
          </button>
        </div>
        <div>
          <h1>Game {gameId}</h1>
          <p>Status: {game?.status ?? "loading..."}</p>
          <p>
            Current turn:{" "}
            {currentPlayer?.displayName ??
              (game?.currentPlayerId ? `Player ${game.currentPlayerId}` : "TBD")}
          </p>
          <p>Players connected: {players.length}</p>
          {error ? <p className="notice">{error}</p> : null}
        </div>
      </section>

      {game?.status === "round-complete" ? (
        <section className="game-results">
          <h2>Final scores</h2>
          <ol>
            {sortedScores.map((player) => (
              <li key={player.id}>
                {player.displayName}: {player.totalScore}
              </li>
            ))}
          </ol>
          <div className="game-results__actions">
            {isHost ? (
              <button
                type="button"
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

      <section className="game-board">
        <div className="game-piles">
          <div className="game-pile">
            <h2>Deck</h2>
            <button
              type="button"
              className="card card--back"
              aria-label="Draw pile (face down)"
              onClick={handleDrawFromDeck}
              disabled={!canDrawFromDeck}
            >
              <span className="card--back-text">Skyjo</span>
            </button>
          </div>
          <div className="game-pile">
            <h2>Discard</h2>
            {typeof topDiscard === "number" ? (
              <button
                type="button"
                className={`card${getCardValueClass(topDiscard)}`}
                aria-label="Discard pile"
                onClick={handleSelectDiscard}
                disabled={!canSelectDiscardTarget}
              >
                {topDiscard}
              </button>
            ) : (
              <div className="card card--discard" aria-label="Empty discard pile">
                —
              </div>
            )}
          </div>
        </div>

        <div className="game-pile">
          <h2>Selected card</h2>
          <>
            {showSelectedCard ? (
              <div className="card card--drawn" aria-label="Selected card">
                {selectedPlayer?.pendingDraw}
              </div>
            ) : (
              <div className="card" aria-label="No selected card">
                —
              </div>
            )}
            <div className="card-tags">
              <span className="card-draw-source">{selectedCardOwnerLabel}</span>
              <span className="card-draw-source">{selectedCardSourceLabel}</span>
            </div>
          </>
        </div>

        <div className="player-grids">
          <h2>Player grids</h2>
          <div className="player-grids__list">
            {orderedPlayers.length ? (
              orderedPlayers.map((player) => {
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
    </main>
  );
}
