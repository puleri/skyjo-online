"use client";

import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  type DocumentData,
  type QueryDocumentSnapshot,
  type UpdateData,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousAuth } from "../lib/auth";
import { GLYPHS } from "../lib/constants";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

type Lobby = {
  id: string;
  name: string;
  status: string;
  players: number;
};

const LOBBIES_PER_PAGE = 5;

export default function LobbyList() {
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [joiningLobbyId, setJoiningLobbyId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<
    Array<QueryDocumentSnapshot<DocumentData> | null>
  >([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const { uid, error: authError } = useAnonymousAuth();
  const firebaseReady = isFirebaseConfigured;
  const router = useRouter();

  useEffect(() => {
    if (!firebaseReady) {
      return;
    }

    const cursor = pageIndex > 0 ? pageCursors[pageIndex - 1] : null;
    if (pageIndex > 0 && !cursor) {
      return;
    }

    setIsLoading(true);
    setHasNextPage(false);
    const lobbyQuery = cursor
      ? query(
          collection(db, "lobbies"),
          orderBy("createdAt", "desc"),
          startAfter(cursor),
          limit(LOBBIES_PER_PAGE)
        )
      : query(
          collection(db, "lobbies"),
          orderBy("createdAt", "desc"),
          limit(LOBBIES_PER_PAGE)
        );
    let isCancelled = false;
    const unsubscribe = onSnapshot(
      lobbyQuery,
      async (snapshot) => {
        const nextLobbies = snapshot.docs.map((doc) => ({
          id: doc.id,
          name: doc.data().name ?? "Untitled lobby",
          status: doc.data().status ?? "open",
          players: doc.data().playerCount ?? doc.data().players ?? 0,
        }));
        if (isCancelled) {
          return;
        }
        setLobbies(nextLobbies);
        setIsLoading(false);
        const lastDoc = snapshot.docs[snapshot.docs.length - 1] ?? null;
        setPageCursors((current) => {
          const existing = current[pageIndex];
          if (existing?.id === lastDoc?.id) {
            return current;
          }
          const next = [...current];
          next[pageIndex] = lastDoc;
          return next;
        });
        if (!lastDoc) {
          setHasNextPage(false);
          return;
        }
        try {
          const nextPageSnapshot = await getDocs(
            query(
              collection(db, "lobbies"),
              orderBy("createdAt", "desc"),
              startAfter(lastDoc),
              limit(1)
            )
          );
          if (!isCancelled) {
            setHasNextPage(!nextPageSnapshot.empty);
          }
        } catch (err) {
          if (!isCancelled) {
            const message = err instanceof Error ? err.message : "Unknown error.";
            setError(message);
            setHasNextPage(false);
          }
        }
      },
      (err) => {
        if (!isCancelled) {
          setError(err.message);
          setIsLoading(false);
        }
      }
    );

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [firebaseReady, pageIndex]);

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
      const storedName = window.localStorage.getItem("skyjo:username");
      const resolvedName = storedName?.trim();
      const lobbyRef = doc(db, "lobbies", lobbyId);
      const playerRef = doc(db, "lobbies", lobbyId, "players", uid);
      await runTransaction(db, async (transaction) => {
        const lobbySnapshot = await transaction.get(lobbyRef);
        if (!lobbySnapshot.exists()) {
          throw new Error("This lobby no longer exists.");
        }

        const lobbyData = lobbySnapshot.data();
        const displayName = resolvedName || "Anonymous player";
        const existingPlayerSnapshot = await transaction.get(playerRef);
        const isHost = (lobbyData.hostId as string | undefined) === uid;
        const availableGlyphs = Array.isArray(lobbyData.availableGlyphs)
          ? lobbyData.availableGlyphs.filter((glyph): glyph is string => typeof glyph === "string")
          : null;
        const assignedGlyphs = Array.isArray(lobbyData.assignedGlyphs)
          ? lobbyData.assignedGlyphs.filter((glyph): glyph is string => typeof glyph === "string")
          : [];
        const glyphPool =
          availableGlyphs && availableGlyphs.length > 0
            ? availableGlyphs
            : GLYPHS.filter((glyph) => !assignedGlyphs.includes(glyph));
        const isExistingPlayer = existingPlayerSnapshot.exists();

        if (!glyphPool.length && !isExistingPlayer) {
          throw new Error("No glyphs are available for this lobby.");
        }
        const glyph = isExistingPlayer
          ? null
          : glyphPool[Math.floor(Math.random() * glyphPool.length)];
        const nextAssignedGlyphs = isExistingPlayer
          ? assignedGlyphs
          : Array.from(new Set([...assignedGlyphs, glyph]));
        const currentPlayerIds = Array.isArray(lobbyData.playerIds)
          ? lobbyData.playerIds.filter((id): id is string => typeof id === "string")
          : [];
        const currentPlayerNames = Array.isArray(lobbyData.playerNames)
          ? lobbyData.playerNames.filter((name): name is string => typeof name === "string")
          : [];
        const playerNameMap = new Map<string, string>();
        currentPlayerIds.forEach((playerId, index) => {
          const existingName = currentPlayerNames[index];
          playerNameMap.set(
            playerId,
            typeof existingName === "string" ? existingName : "Anonymous player"
          );
        });
        if (!playerNameMap.has(uid)) {
          currentPlayerIds.push(uid);
        }
        playerNameMap.set(uid, displayName);
        const nextPlayerIds = currentPlayerIds.filter(
          (playerId, index) => currentPlayerIds.indexOf(playerId) === index
        );
        const nextPlayerNames = nextPlayerIds.map(
          (playerId) => playerNameMap.get(playerId) ?? "Anonymous player"
        );
        const lobbyUpdates: UpdateData<DocumentData> = {
          assignedGlyphs: nextAssignedGlyphs,
          playerCount: nextPlayerIds.length,
          playerIds: nextPlayerIds,
          playerNames: nextPlayerNames,
          players: nextPlayerIds.length,
        };
        if (isHost) {
          lobbyUpdates.hostDisplayName = displayName;
        }

        if (!isExistingPlayer && availableGlyphs && availableGlyphs.length > 0) {
          lobbyUpdates.availableGlyphs = availableGlyphs.filter(
            (availableGlyph) => availableGlyph !== glyph
          );
        }

        if (isExistingPlayer) {
          transaction.update(playerRef, { displayName });
        } else {
          transaction.set(playerRef, {
            displayName,
            joinedAt: serverTimestamp(),
            isReady: false,
            glyph,
          });
        }
        transaction.update(lobbyRef, lobbyUpdates);
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

  if (isLoading) {
    return <p>Loading lobbies…</p>;
  }

  if (!lobbies.length) {
    return <p>No lobbies yet. Create one above.</p>;
  }

  const visibleLobbies = lobbies;

  return (
    <div>
      <ul>
        {visibleLobbies.map((lobby) => {
          const buttonLabel =
            joiningLobbyId === lobby.id
              ? "Joining..."
              : lobby.status === "open"
                  ? "Join"
                  : "Spectate";
          const buttonClassName = lobby.status === "open" ? "join-button" : "spectate-button";

          return (
            <li key={lobby.id}>
              <div>
                <strong className="name-lobby-list">{lobby.name}</strong>
                <div>
                  <small className="player-lobby-list">
                    {lobby.players} players
                  </small>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  className={buttonClassName}
                  onClick={() => handleJoin(lobby.id)}
                  disabled={isLoading || !uid || joiningLobbyId === lobby.id}
                >
                  {buttonLabel}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {!isLoading && (pageIndex > 0 || hasNextPage) ? (
        <div className="lobby-pagination">
          <button
            type="button"
            className="pagination-button"
            onClick={() => setPageIndex((current) => Math.max(current - 1, 0))}
            disabled={isLoading || pageIndex === 0}
          >
            Previous
          </button>
          <span className="pagination-status">Page {pageIndex + 1}</span>
          <button
            type="button"
            className="pagination-button"
            onClick={() => setPageIndex((current) => current + 1)}
            disabled={isLoading || !hasNextPage}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
