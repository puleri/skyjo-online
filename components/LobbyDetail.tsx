"use client";

import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
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

export default function LobbyDetail({ lobbyId }: LobbyDetailProps) {
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const { uid, error: authError } = useAnonymousAuth();
  const firebaseReady = isFirebaseConfigured;

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
    if (authError) {
      setError(authError);
    }
  }, [authError]);

  const currentPlayer = useMemo(
    () => (uid ? players.find((player) => player.id === uid) ?? null : null),
    [players, uid]
  );

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
