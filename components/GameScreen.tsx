"use client";

import { collection, doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PlayerGrid from "./PlayerGrid";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

type GameScreenProps = {
  gameId: string;
};

type GameMeta = {
  status: string;
  currentPlayerId: string | null;
  activePlayerOrder: string[];
};

type GamePlayer = {
  id: string;
  displayName: string;
  isReady: boolean;
  grid?: Array<number | null>;
  revealed?: boolean[];
};

export default function GameScreen({ gameId }: GameScreenProps) {
  const router = useRouter();
  const firebaseReady = isFirebaseConfigured;
  const [game, setGame] = useState<GameMeta | null>(null);
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseReady) {
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
        });
      },
      (err) => {
        setError(err.message);
      }
    );

    return () => unsubscribe();
  }, [firebaseReady, gameId]);

  useEffect(() => {
    if (!firebaseReady) {
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
            <div className="card-slot">Draw pile</div>
          </div>
          <div className="game-pile">
            <h2>Discard</h2>
            <div className="card-slot">Discard pile</div>
          </div>
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
