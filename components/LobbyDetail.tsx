"use client";

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousAuth } from "../lib/auth";
import { GLYPHS } from "../lib/constants";
import { createSkyjoDeck, shuffleDeck } from "../lib/game/deck";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

type LobbyPlayer = {
  id: string;
  displayName: string;
  isReady: boolean;
  glyph: string;
};

type LobbyDetailProps = {
  lobbyId: string;
};

type LobbyMeta = {
  hostId: string | null;
  gameId: string | null;
  status: string;
};

export default function LobbyDetail({ lobbyId }: LobbyDetailProps) {
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [lobby, setLobby] = useState<LobbyMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const { uid, error: authError } = useAnonymousAuth();
  const firebaseReady = isFirebaseConfigured;
  const router = useRouter();

  useEffect(() => {
    if (!firebaseReady || !lobbyId) {
      return;
    }

    const playerCollection = collection(db, "lobbies", lobbyId, "players");
    const unsubscribe = onSnapshot(
      playerCollection,
      (snapshot) => {
        const nextPlayers = snapshot.docs.map((doc) => ({
          id: doc.id,
          displayName: doc.data().displayName ?? "Anonymous player",
          isReady: Boolean(doc.data().isReady),
          glyph: (doc.data().glyph as string | undefined) ?? "player-glyph-sun",
        }));
        setPlayers(nextPlayers);
      },
      (err) => {
        setError(err.message);
      }
    );

    return () => unsubscribe();
  }, [firebaseReady, lobbyId]);

  useEffect(() => {
    if (!firebaseReady || !lobbyId) {
      return;
    }

    const lobbyRef = doc(db, "lobbies", lobbyId);
    const unsubscribe = onSnapshot(
      lobbyRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setLobby(null);
          return;
        }
        const data = snapshot.data();
        setLobby({
          hostId: (data.hostId as string | undefined) ?? null,
          gameId: (data.gameId as string | undefined) ?? null,
          status: (data.status as string | undefined) ?? "open",
        });
      },
      (err) => {
        setError(err.message);
      }
    );

    return () => unsubscribe();
  }, [firebaseReady, lobbyId]);

  useEffect(() => {
    if (authError) {
      setError(authError);
    }
  }, [authError]);

  useEffect(() => {
    if (lobby?.gameId) {
      router.push(`/game/${lobby.gameId}`);
    }
  }, [lobby?.gameId, router]);

  const currentPlayer = useMemo(
    () => (uid ? players.find((player) => player.id === uid) ?? null : null),
    [players, uid]
  );
  const isHost = Boolean(uid && lobby?.hostId && uid === lobby.hostId);
  const hostPlayer = useMemo(
    () => (lobby?.hostId ? players.find((player) => player.id === lobby.hostId) ?? null : null),
    [players, lobby?.hostId]
  );
  const allPlayersReady = players.length > 0 && players.every((player) => player.isReady);

  const handleToggleReady = async () => {
    if (!uid) {
      setError("Sign in to update your readiness.");
      return;
    }

    if (!currentPlayer) {
      setError("Join the lobby before updating readiness.");
      return;
    }

    setIsUpdating(true);
    setError(null);
    try {
      await updateDoc(doc(db, "lobbies", lobbyId, "players", uid), {
        isReady: !currentPlayer.isReady,
      });
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

    setIsStarting(true);
    setError(null);
    try {
      const lobbyRef = doc(db, "lobbies", lobbyId);
      const gameRef = doc(collection(db, "games"));
      await runTransaction(db, async (transaction) => {
        const playerQuery = query(
          collection(db, "lobbies", lobbyId, "players"),
          orderBy("joinedAt", "asc")
        );
        const playerSnapshot = await getDocs(playerQuery);
        if (playerSnapshot.empty) {
          throw new Error("Add at least one player before starting.");
        }

        const playerOrder = playerSnapshot.docs.map((playerDoc) => playerDoc.id);
        const shuffledDeck = shuffleDeck(createSkyjoDeck());
        const playerGrids = new Map<string, number[]>();
        playerOrder.forEach((playerId) => {
          const grid: number[] = [];
          for (let i = 0; i < 12; i += 1) {
            const card = shuffledDeck.pop();
            if (typeof card !== "number") {
              throw new Error("Not enough cards to deal the opening hands.");
            }
            grid.push(card);
          }
          playerGrids.set(playerId, grid);
        });

        const discardCard = shuffledDeck.pop();
        if (typeof discardCard !== "number") {
          throw new Error("Deck is empty after dealing.");
        }
        const startingPlayerId =
          playerOrder[Math.floor(Math.random() * playerOrder.length)] ?? playerOrder[0];

        transaction.set(gameRef, {
          status: "playing",
          lobbyId,
          hostId: uid,
          roundNumber: 1,
          currentPlayerId: startingPlayerId,
          activePlayerOrder: playerOrder,
          turnPhase: "choose-draw",
          deck: shuffledDeck,
          discard: [discardCard],
          lastTurnPlayerId: null,
          lastTurnAction: null,
          createdAt: serverTimestamp(),
        });

        playerSnapshot.docs.forEach((playerDoc, index) => {
          const data = playerDoc.data();
          transaction.set(doc(db, "games", gameRef.id, "players", playerDoc.id), {
            displayName: data.displayName ?? "Anonymous player",
            seatIndex: index,
            grid: playerGrids.get(playerDoc.id) ?? [],
            revealed: Array.from({ length: 12 }, () => false),
            roundScore: 0,
            totalScore: 0,
          });
        });

        transaction.update(lobbyRef, { status: "in-game", gameId: gameRef.id });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsStarting(false);
    }
  };

  if (!lobbyId) {
    return (
      <div className="notice">
        <strong>Loading lobby...</strong>
        <p>Waiting for a lobby ID before connecting to Firestore.</p>
      </div>
    );
  }

  if (!firebaseReady) {
    return (
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
    );
  }

  return (
    <section className="lobby-detail">
      <header className="lobby-detail__header">
        <div>
          <h1>Lobby {lobbyId}</h1>
          <p>Players connected: {players.length}</p>
          <p>Glyphs available: {GLYPHS.length}</p>
        </div>
        <div className="lobby-detail__actions">
          <button
            type="button"
            onClick={handleToggleReady}
            disabled={!uid || !currentPlayer || isUpdating}
          >
            {isUpdating
              ? "Updating..."
              : currentPlayer?.isReady
              ? "Set not ready"
              : "Set ready"}
          </button>
          {isHost ? (
            <button
              type="button"
              onClick={handleStartGame}
              disabled={!allPlayersReady || isStarting}
            >
              {isStarting ? "Starting..." : "Start game"}
            </button>
          ) : (
            <p className="lobby-detail__waiting">
              Waiting for {hostPlayer?.displayName ?? "the host"} to start game.
            </p>
          )}
        </div>
      </header>

      {error ? <p className="notice">Firestore error: {error}</p> : null}

      {!players.length ? (
        <p>No players have joined this lobby yet.</p>
      ) : (
        <section className="lobby-scene" aria-label="Lobby players">
          {players.map((player) => (
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
              <span className="lobby-player__name">{player.displayName}</span>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
