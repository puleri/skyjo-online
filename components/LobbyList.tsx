"use client";

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type DocumentData,
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

const MAX_PLAYER_NAMES_LENGTH = 60;
const LOBBIES_PER_PAGE = 5;

export default function LobbyList() {
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [lobbyPlayers, setLobbyPlayers] = useState<Record<string, string[]>>({});
  const [lobbyPlayerIds, setLobbyPlayerIds] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [joiningLobbyId, setJoiningLobbyId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
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
        setIsLoading(false);
      },
      (err) => {
        setError(err.message);
        setIsLoading(false);
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
      setLobbyPlayerIds({});
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
          const playerDocs = snapshot.docs;
          const playerNames = playerDocs.map(
            (playerDoc) => playerDoc.data().displayName ?? "Anonymous player"
          );
          const playerIds = playerDocs.map((playerDoc) => playerDoc.id);
          setLobbyPlayers((prev) => ({
            ...prev,
            [lobby.id]: playerNames,
          }));
          setLobbyPlayerIds((prev) => ({
            ...prev,
            [lobby.id]: playerIds,
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
    if (authError) {
      setError(authError);
    }
  }, [authError]);

  useEffect(() => {
    if (!lobbies.length) {
      setPageIndex(0);
      return;
    }

    const maxPageIndex = Math.max(Math.ceil(lobbies.length / LOBBIES_PER_PAGE) - 1, 0);
    setPageIndex((current) => Math.min(current, maxPageIndex));
  }, [lobbies.length]);

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

        if (!glyphPool.length) {
          throw new Error("No glyphs are available for this lobby.");
        }

        const glyph = glyphPool[Math.floor(Math.random() * glyphPool.length)];
        const nextAssignedGlyphs = Array.from(new Set([...assignedGlyphs, glyph]));
        const lobbyUpdates: UpdateData<DocumentData> = {
          assignedGlyphs: nextAssignedGlyphs,
        };
        if (isHost) {
          lobbyUpdates.hostDisplayName = displayName;
        }

        if (availableGlyphs && availableGlyphs.length > 0) {
          lobbyUpdates.availableGlyphs = availableGlyphs.filter(
            (availableGlyph) => availableGlyph !== glyph
          );
        }

        transaction.set(playerRef, {
          displayName,
          joinedAt: serverTimestamp(),
          isReady: false,
          glyph,
        });
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

  const totalPages = Math.ceil(lobbies.length / LOBBIES_PER_PAGE);
  const startIndex = pageIndex * LOBBIES_PER_PAGE;
  const visibleLobbies = lobbies.slice(startIndex, startIndex + LOBBIES_PER_PAGE);

  return (
    <div>
      <ul>
        {visibleLobbies.map((lobby) => {
          const isPlayerInLobby = uid ? lobbyPlayerIds[lobby.id]?.includes(uid) : false;
          const buttonLabel =
            joiningLobbyId === lobby.id
              ? "Joining..."
              : isPlayerInLobby
                ? "Rejoin"
                : lobby.status === "open"
                  ? "Join"
                  : "Spectate";
          const buttonClassName =
            isPlayerInLobby || lobby.status === "open" ? "join-button" : "spectate-button";

          return (
            <li key={lobby.id}>
              <div>
                <strong className="name-lobby-list">{lobby.name}</strong>
                <div>
                  <small className="player-lobby-list">
                    {formatPlayerNames(lobbyPlayers[lobby.id] ?? [])}
                  </small>
                </div>
              </div>
              <div>
                {/* <small className="mr-10">{lobby.players} players</small> */}
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
      {!isLoading && totalPages > 1 ? (
        <div className="lobby-pagination">
          <button
            type="button"
            className="pagination-button"
            onClick={() => setPageIndex((current) => Math.max(current - 1, 0))}
            disabled={isLoading || pageIndex === 0}
          >
            Previous
          </button>
          <span className="pagination-status">
            Page {pageIndex + 1} of {totalPages}
          </span>
          <button
            type="button"
            className="pagination-button"
            onClick={() => setPageIndex((current) => Math.min(current + 1, totalPages - 1))}
            disabled={isLoading || pageIndex + 1 >= totalPages}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
