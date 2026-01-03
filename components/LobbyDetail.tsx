"use client";

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

type LobbyPlayer = {
  id: string;
  displayName: string;
  isReady: boolean;
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
    if (!firebaseReady) {
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
    if (!firebaseReady) {
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
      const playerQuery = query(
        collection(db, "lobbies", lobbyId, "players"),
        orderBy("joinedAt", "asc")
      );
      const playerSnapshot = await getDocs(playerQuery);
      if (playerSnapshot.empty) {
        setError("Add at least one player before starting.");
        return;
      }

      const playerOrder = playerSnapshot.docs.map((playerDoc) => playerDoc.id);
      const gameRef = doc(collection(db, "games"));
      const batch = writeBatch(db);
      batch.set(gameRef, {
        status: "active",
        lobbyId,
        roundNumber: 1,
        activePlayerOrder: playerOrder,
        createdAt: serverTimestamp(),
      });
      playerSnapshot.forEach((playerDoc) => {
        batch.set(doc(db, "games", gameRef.id, "players", playerDoc.id), playerDoc.data());
      });
      batch.update(lobbyRef, { status: "in-game", gameId: gameRef.id });
      await batch.commit();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsStarting(false);
    }
  };

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
          <button
            type="button"
            onClick={handleStartGame}
            disabled={!isHost || !allPlayersReady || isStarting}
          >
            {isStarting ? "Starting..." : "Start game"}
          </button>
        </div>
      </header>

      {error ? <p className="notice">Firestore error: {error}</p> : null}

      {!players.length ? (
        <p>No players have joined this lobby yet.</p>
      ) : (
        <ul className="lobby-detail__players">
          {players.map((player) => (
            <li key={player.id}>
              <span>{player.displayName}</span>
              <span>{player.isReady ? "Ready" : "Not ready"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
