"use client";

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

type Lobby = {
  id: string;
  name: string;
  status: string;
  players: number;
};

type LobbyPlayers = Record<string, string[]>;

const displayNameStorageKey = "skyjo-display-name";

export default function LobbyList() {
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [playerNames, setPlayerNames] = useState<LobbyPlayers>({});
  const [displayName, setDisplayName] = useState("");
  const [hasStoredName, setHasStoredName] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firebaseReady = isFirebaseConfigured;
  const { uid, error: authError } = useAnonymousAuth();
  const displayNameTrimmed = displayName.trim();

  useEffect(() => {
    if (!firebaseReady) {
      return;
    }

    const lobbyQuery = query(collection(db, "lobbies"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      lobbyQuery,
      (snapshot) => {
        const nextLobbies = snapshot.docs.map((doc) => ({
          id: doc.id,
          name: doc.data().name ?? "Untitled lobby",
          status: doc.data().status ?? "open",
          players: doc.data().players ?? 0,
        }));
        setLobbies(nextLobbies);
      },
      (err) => {
        setError(err.message);
      }
    );

    return () => unsubscribe();
  }, [firebaseReady]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedName = window.localStorage.getItem(displayNameStorageKey);
    if (storedName) {
      setDisplayName(storedName);
      setHasStoredName(true);
    }
  }, []);

  useEffect(() => {
    if (!firebaseReady || !lobbies.length) {
      setPlayerNames({});
      return;
    }

    const unsubscribers = lobbies.map((lobby) =>
      onSnapshot(collection(db, "lobbies", lobby.id, "players"), (snapshot) => {
        setPlayerNames((prev) => ({
          ...prev,
          [lobby.id]: snapshot.docs
            .map((docSnapshot) => docSnapshot.data().displayName)
            .filter((name) => typeof name === "string"),
        }));
      })
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [firebaseReady, lobbies]);

  const authNotice = useMemo(() => {
    if (!authError) {
      return null;
    }

    return <p className="notice">Auth error: {authError}</p>;
  }, [authError]);

  const handleSaveDisplayName = () => {
    if (!displayNameTrimmed) {
      return;
    }

    window.localStorage.setItem(displayNameStorageKey, displayNameTrimmed);
    setDisplayName(displayNameTrimmed);
    setHasStoredName(true);
  };

  const handleJoinLobby = async (lobbyId: string) => {
    if (!firebaseReady || !uid || !displayNameTrimmed) {
      return;
    }

    setJoinError(null);

    try {
      const playersRef = collection(db, "lobbies", lobbyId, "players");
      const playersSnapshot = await getDocs(playersRef);
      const existingPlayer = playersSnapshot.docs.find((docSnapshot) => docSnapshot.id === uid);
      const seatIndex =
        typeof existingPlayer?.data().seatIndex === "number"
          ? existingPlayer.data().seatIndex
          : playersSnapshot.size;

      await setDoc(doc(db, "lobbies", lobbyId, "players", uid), {
        displayName: displayNameTrimmed,
        joinedAt: serverTimestamp(),
        isReady: false,
        seatIndex,
      });

      if (!existingPlayer) {
        await updateDoc(doc(db, "lobbies", lobbyId), {
          players: playersSnapshot.size + 1,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setJoinError(message);
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

  if (error) {
    return <p className="notice">Firestore error: {error}</p>;
  }

  if (!lobbies.length) {
    return <p>No lobbies yet. Create one above to see real-time updates.</p>;
  }

  return (
    <>
      <div className="notice">
        <strong>Choose a display name</strong>
        <p>Set this once to show up in lobby rosters.</p>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Card Shark"
        />
        <button type="button" onClick={handleSaveDisplayName} disabled={!displayNameTrimmed}>
          {hasStoredName ? "Update name" : "Save name"}
        </button>
        {authNotice}
      </div>
      {joinError ? <p className="notice">Join error: {joinError}</p> : null}
      <ul>
        {lobbies.map((lobby) => {
          const names = playerNames[lobby.id] ?? [];
          return (
            <li key={lobby.id}>
              <div>
                <strong>{lobby.name}</strong>
                <div>
                  <small>Status: {lobby.status}</small>
                </div>
                {names.length ? (
                  <small>Players: {names.join(", ")}</small>
                ) : (
                  <small>No players yet</small>
                )}
              </div>
              <div>
                <small>{lobby.players} players</small>
                <button
                  type="button"
                  onClick={() => handleJoinLobby(lobby.id)}
                  disabled={!uid || !displayNameTrimmed}
                >
                  Join lobby
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
