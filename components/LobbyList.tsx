"use client";

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

type Lobby = {
  id: string;
  name: string;
  status: string;
  players: number;
};

const MAX_PLAYER_NAMES_LENGTH = 60;

export default function LobbyList() {
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [lobbyPlayers, setLobbyPlayers] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("");
  const [joiningLobbyId, setJoiningLobbyId] = useState<string | null>(null);
  const { uid, error: authError } = useAnonymousAuth();
  const firebaseReady = isFirebaseConfigured;
  const router = useRouter();

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
    if (!firebaseReady) {
      return;
    }

    if (!lobbies.length) {
      setLobbyPlayers({});
      return;
    }

    const unsubscribers = lobbies.map((lobby) => {
      const playerQuery = query(
        collection(db, "lobbies", lobby.id, "players"),
        orderBy("joinedAt", "asc")
      );
      return onSnapshot(
        playerQuery,
        (snapshot) => {
          const playerNames = snapshot.docs.map(
            (playerDoc) => playerDoc.data().displayName ?? "Anonymous player"
          );
          setLobbyPlayers((prev) => ({
            ...prev,
            [lobby.id]: playerNames,
          }));
        },
        (err) => {
          setError(err.message);
        }
      );
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [firebaseReady, lobbies]);

  useEffect(() => {
    const storedName = window.localStorage.getItem("skyjo:username");
    if (storedName) {
      setDisplayName(storedName);
    }
  }, []);

  useEffect(() => {
    if (authError) {
      setError(authError);
    }
  }, [authError]);

  const handleJoin = async (lobbyId: string) => {
    if (!uid) {
      setError("Unable to join a lobby without a signed-in user.");
      return;
    }

    setJoiningLobbyId(lobbyId);
    setError(null);
    try {
      await setDoc(doc(db, "lobbies", lobbyId, "players", uid), {
        displayName: displayName.trim() || "Anonymous player",
        joinedAt: serverTimestamp(),
        isReady: false,
      });
      router.push(`/lobby/${lobbyId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setJoiningLobbyId(null);
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

  const formatPlayerNames = (names: string[]) => {
    if (!names.length) {
      return "No players yet";
    }

    const joinedNames = names.join(", ");
    if (joinedNames.length <= MAX_PLAYER_NAMES_LENGTH) {
      return joinedNames;
    }

    return `${joinedNames.slice(0, MAX_PLAYER_NAMES_LENGTH)}…`;
  };

  return (
    <ul>
      {lobbies.map((lobby) => (
        <li key={lobby.id}>
          <div>
            <strong className="name-lobby-list">{lobby.name}</strong>
            <div>
              <small className="player-lobby-list">{formatPlayerNames(lobbyPlayers[lobby.id] ?? [])}</small>
            </div>
          </div>
          <div>
            {/* <small className="mr-10">{lobby.players} players</small> */}
            <button
              type="button"
              className={lobby.status === "open" ? "join-button" : "spectate-button"}
              onClick={() => handleJoin(lobby.id)}
              disabled={!uid || joiningLobbyId === lobby.id}
            >
              {joiningLobbyId === lobby.id
                ? "Joining..."
                : lobby.status === "open"
                  ? "Join"
                  : "Spectate"}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
