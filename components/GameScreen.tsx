"use client";

import { collection, doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PlayerGrid from "./PlayerGrid";
import {
  discardPendingDraw,
  drawFromDeck,
  drawFromDiscard,
  revealAfterDiscard,
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
  turnPhase: string;
};

type GamePlayer = {
  id: string;
  displayName: string;
  isReady: boolean;
  grid?: Array<number | null>;
  revealed?: boolean[];
  pendingDraw?: number | null;
  pendingDrawSource?: "deck" | "discard" | null;
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
          turnPhase: (data.turnPhase as string | undefined) ?? "choose-draw",
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

  const opponentPlayers = orderedPlayers.filter((player) => player.id !== game?.currentPlayerId);
  const topDiscard =
    game?.discard && game.discard.length > 0 ? game.discard[game.discard.length - 1] : null;
  const isCurrentTurn = Boolean(uid && game?.currentPlayerId && uid === game.currentPlayerId);
  const selectedPlayer = useMemo(
    () => orderedPlayers.find((player) => typeof player.pendingDraw === "number") ?? null,
    [orderedPlayers]
  );
  const selectedCardOwnerLabel = selectedPlayer
    ? selectedPlayer.id === uid
      ? "Your card"
      : `${selectedPlayer.displayName}'s card`
    : null;
  const selectedCardSourceLabel =
    selectedPlayer?.pendingDrawSource === "discard"
      ? "Picked from discard pile"
      : "Drawn from draw pile";
  const canDrawFromDeck =
    isCurrentTurn &&
    game?.turnPhase === "choose-draw" &&
    typeof currentPlayer?.pendingDraw !== "number" &&
    (game?.deck.length ?? 0) > 0;
  const canSelectDiscardTarget =
    isCurrentTurn &&
    game?.turnPhase === "choose-draw" &&
    typeof currentPlayer?.pendingDraw !== "number" &&
    (game?.discard.length ?? 0) > 0;
  const showDrawnCard = isCurrentTurn && typeof currentPlayer?.pendingDraw === "number";
  const showSelectedCard = typeof selectedPlayer?.pendingDraw === "number";
  const canSelectGridCard = showDrawnCard || discardSelectionActive;

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
                className="card card--discard"
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
          {showSelectedCard ? (
            <>
              <div className="card card--drawn" aria-label="Selected card">
                {selectedPlayer?.pendingDraw}
              </div>
              <div className="card-tags">
                {selectedCardOwnerLabel ? (
                  <span className="card-draw-source">{selectedCardOwnerLabel}</span>
                ) : null}
                <span className="card-draw-source">{selectedCardSourceLabel}</span>
              </div>
            </>
          ) : (
            <div className="card" aria-label="No selected card">
              —
            </div>
          )}
        </div>

        <div>
          <h2>Main grid</h2>
          <PlayerGrid
            label={
              currentPlayer
                ? `${currentPlayer.displayName}${currentPlayer.isReady ? " (ready)" : ""}`
                : "Awaiting current player"
            }
            size="main"
            grid={currentPlayer?.grid}
            revealed={currentPlayer?.revealed}
            onCardSelect={canSelectGridCard ? handleSelectGridCard : undefined}
            activeActionIndex={activeActionIndex}
            onReplace={showDrawnCard ? handleReplace : undefined}
            onReveal={showDrawnCard ? handleReveal : undefined}
            onCancel={showDrawnCard ? handleCancelMenu : undefined}
          />
        </div>

        <div>
          <h2>Mini grids</h2>
          <div className="mini-grids">
            {opponentPlayers.length ? (
              opponentPlayers.map((opponent) => (
                <div key={opponent.id} className="mini-grid">
                  <PlayerGrid
                    label={`${opponent.displayName}${opponent.isReady ? " (ready)" : ""}`}
                    size="mini"
                    grid={opponent.grid}
                    revealed={opponent.revealed}
                  />
                </div>
              ))
            ) : (
              <p>No other players yet.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
