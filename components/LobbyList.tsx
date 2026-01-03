"use client";

import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

type Lobby = {
  id: string;
  name: string;
  status: string;
  players: number;
  hostId?: string;
  gameId?: string;
};

type LobbyPlayer = {
  id: string;
  displayName: string;
  isReady: boolean;
  seatIndex?: number;
};

type LobbyPlayers = Record<string, LobbyPlayer[]>;

const displayNameStorageKey = "skyjo-display-name";
const cardsPerPlayer = 12;

const createDeck = () => {
  const cardCounts: Array<[number, number]> = [
    [-2, 5],
    [-1, 10],
    [0, 15],
    [1, 10],
    [2, 10],
    [3, 10],
    [4, 10],
    [5, 10],
    [6, 10],
    [7, 10],
    [8, 10],
    [9, 10],
    [10, 10],
    [11, 10],
    [12, 10],
  ];

  const deck: number[] = [];
  cardCounts.forEach(([value, count]) => {
    for (let i = 0; i < count; i += 1) {
      deck.push(value);
    }
  });

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
};

const dealHands = (deck: number[], playerIds: string[]) => {
  let cursor = 0;
  const grids: Record<string, number[]> = {};

  playerIds.forEach((playerId) => {
    grids[playerId] = deck.slice(cursor, cursor + cardsPerPlayer);
    cursor += cardsPerPlayer;
  });

  return {
    grids,
    remainingDeck: deck.slice(cursor),
  };
};

const createRevealedGrid = () => Array(cardsPerPlayer).fill(false);

const pickRandomPlayerId = (playerIds: string[]) =>
  playerIds[Math.floor(Math.random() * playerIds.length)];

const pickHighestScorePlayerId = (
  playerIds: string[],
  roundScores: Record<string, number>
) =>
  playerIds.reduce((leadingPlayerId, playerId) => {
    const leadingScore = roundScores[leadingPlayerId] ?? Number.NEGATIVE_INFINITY;
    const candidateScore = roundScores[playerId] ?? Number.NEGATIVE_INFINITY;
    return candidateScore > leadingScore ? playerId : leadingPlayerId;
  }, playerIds[0]);

const startNewRound = (
  playerIds: string[],
  roundScores: Record<string, number>
) => {
  const startingPlayerId = pickHighestScorePlayerId(playerIds, roundScores);
  const deck = createDeck();
  const { grids, remainingDeck } = dealHands(deck, playerIds);
  const revealed = createRevealedGrid();

  return {
    startingPlayerId,
    currentPlayerId: startingPlayerId,
    deck: remainingDeck,
    discard: [] as number[],
    status: "playing",
    playerUpdates: playerIds.map((playerId) => ({
      playerId,
      grid: grids[playerId],
      revealed: [...revealed],
    })),
  };
};

export default function LobbyList() {
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [playerNames, setPlayerNames] = useState<LobbyPlayers>({});
  const [displayName, setDisplayName] = useState("");
  const [hasStoredName, setHasStoredName] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
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
          hostId: doc.data().hostId,
          gameId: doc.data().gameId,
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
            .map((docSnapshot) => ({
              id: docSnapshot.id,
              displayName: docSnapshot.data().displayName ?? "Player",
              isReady: Boolean(docSnapshot.data().isReady),
              seatIndex: docSnapshot.data().seatIndex,
            }))
            .filter((player) => typeof player.displayName === "string"),
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
    setStartError(null);

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

  const handleToggleReady = async (lobbyId: string, isReady: boolean) => {
    if (!firebaseReady || !uid) {
      return;
    }

    setStartError(null);

    try {
      await updateDoc(doc(db, "lobbies", lobbyId, "players", uid), {
        isReady: !isReady,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setStartError(message);
    }
  };

  const handleStartGame = async (lobby: Lobby) => {
    if (!firebaseReady || !uid || lobby.hostId !== uid) {
      return;
    }

    setStartError(null);

    const lobbyPlayers = playerNames[lobby.id] ?? [];
    const orderedPlayers = [...lobbyPlayers].sort(
      (a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0)
    );
    const activePlayerOrder = orderedPlayers.map((player) => player.id);

    if (!activePlayerOrder.length) {
      setStartError("Need at least one player to start.");
      return;
    }

    try {
      const deck = createDeck();
      const { grids, remainingDeck } = dealHands(deck, activePlayerOrder);
      const revealed = createRevealedGrid();
      const currentPlayerId = pickRandomPlayerId(activePlayerOrder);
      const startingPlayerId = currentPlayerId;
      const gameRef = await addDoc(collection(db, "games"), {
        status: "playing",
        lobbyId: lobby.id,
        createdAt: serverTimestamp(),
        roundNumber: 1,
        activePlayerOrder,
        currentPlayerId,
        startingPlayerId,
        deck: remainingDeck,
        discard: [],
      });

      const batch = writeBatch(db);
      orderedPlayers.forEach((player) => {
        batch.set(doc(db, "games", gameRef.id, "players", player.id), {
          displayName: player.displayName ?? "Player",
          seatIndex: player.seatIndex ?? null,
          grid: grids[player.id],
          revealed: [...revealed],
        });
      });
      batch.update(doc(db, "lobbies", lobby.id), {
        status: "in-game",
        gameId: gameRef.id,
      });
      await batch.commit();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setStartError(message);
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
      {startError ? <p className="notice">Start error: {startError}</p> : null}
      <ul>
        {lobbies.map((lobby) => {
          const players = playerNames[lobby.id] ?? [];
          const currentPlayer = players.find((player) => player.id === uid);
          const allReady = players.length > 0 && players.every((player) => player.isReady);
          const isHost = lobby.hostId && uid && lobby.hostId === uid;
          return (
            <li key={lobby.id}>
              <div>
                <strong>{lobby.name}</strong>
                <div>
                  <small>Status: {lobby.status}</small>
                </div>
                {players.length ? (
                  <div>
                    <small>Players</small>
                    <ul>
                      {players.map((player) => (
                        <li key={player.id}>
                          <span>{player.displayName}</span>{" "}
                          <small>{player.isReady ? "Ready" : "Not ready"}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
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
                {currentPlayer ? (
                  <button
                    type="button"
                    onClick={() => handleToggleReady(lobby.id, currentPlayer.isReady)}
                    disabled={!uid}
                  >
                    {currentPlayer.isReady ? "Set not ready" : "Set ready"}
                  </button>
                ) : null}
                {isHost ? (
                  <button
                    type="button"
                    onClick={() => handleStartGame(lobby)}
                    disabled={!allReady || lobby.status !== "open"}
                  >
                    Start game
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
