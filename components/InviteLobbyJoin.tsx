"use client";

import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type UpdateData,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousAuth } from "../lib/auth";
import { GLYPHS } from "../lib/constants";
import { app, db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";
import LoadingSwipeOverlay from "./LoadingSwipeOverlay";

type InviteLobbyJoinProps = {
  lobbyId: string;
};

type LobbyMeta = {
  hostId: string | null;
  status: string;
  gameId: string | null;
};

const storageKey = "misty:username";

export default function InviteLobbyJoin({ lobbyId }: InviteLobbyJoinProps) {
  const [lobby, setLobby] = useState<LobbyMeta | null>(null);
  const [lobbyState, setLobbyState] = useState<"loading" | "exists" | "missing" | "error">(
    "loading"
  );
  const [hostName, setHostName] = useState("A player");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(true);
  const { uid, error: authError, signInAsAnonymous } = useAnonymousAuth();
  const firebaseReady = isFirebaseConfigured;
  const router = useRouter();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowLoadingOverlay(false);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    setLobbyState("loading");
    setLobby(null);
    setHostName("A player");
    setError(null);

    if (!firebaseReady || !lobbyId) {
      return;
    }

    const lobbyRef = doc(db, "lobbies", lobbyId);
    const unsubscribe = onSnapshot(
      lobbyRef,
      (snapshot) => {
        setError(null);
        if (!snapshot.exists()) {
          setLobbyState("missing");
          setLobby(null);
          setHostName("A player");
          return;
        }
        const data = snapshot.data();
        setLobbyState("exists");
        setLobby({
          hostId: (data.hostId as string | undefined) ?? null,
          status: (data.status as string | undefined) ?? "open",
          gameId: (data.gameId as string | undefined) ?? null,
        });
        setHostName((data.hostDisplayName as string | undefined) ?? "A player");
      },
      (err) => {
        setLobbyState("error");
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
    const storedName = window.localStorage.getItem(storageKey);
    if (storedName) {
      setUsername(storedName);
    }
  }, []);

  const inviteMessage = useMemo(
    () => `${hostName} invited you to their misty lobby, please make a username first`,
    [hostName]
  );
  const isInGame = lobby?.status === "in-game";
  const canSpectate = isInGame && Boolean(lobby?.gameId);

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = username.trim();
    if (!trimmedName) {
      setError("Enter a username before joining.");
      return;
    }

    setIsJoining(true);
    setError(null);
    try {
      let resolvedUid = uid;
      if (!resolvedUid) {
        await signInAsAnonymous();
        resolvedUid = getAuth(app).currentUser?.uid ?? null;
      }

      if (!resolvedUid) {
        setError("Unable to sign in anonymously. Please try again.");
        return;
      }

      const lobbyRef = doc(db, "lobbies", lobbyId);
      const playerRef = doc(db, "lobbies", lobbyId, "players", resolvedUid);
      await runTransaction(db, async (transaction) => {
        const lobbySnapshot = await transaction.get(lobbyRef);
        if (!lobbySnapshot.exists()) {
          throw new Error("This lobby no longer exists.");
        }

        const lobbyData = lobbySnapshot.data();
        if ((lobbyData.status as string | undefined) === "in-game") {
          const gameId = (lobbyData.gameId as string | undefined) ?? null;
          if (gameId) {
            throw new Error("This lobby is already in a game. Spectate instead.");
          }
          throw new Error("This lobby is already in a game.");
        }

        const playerSnapshot = await transaction.get(playerRef);
        const isHost = (lobbyData.hostId as string | undefined) === resolvedUid;
        if (playerSnapshot.exists()) {
          transaction.update(playerRef, { displayName: trimmedName });
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
          if (!playerNameMap.has(resolvedUid)) {
            currentPlayerIds.push(resolvedUid);
          }
          playerNameMap.set(resolvedUid, trimmedName);
          const nextPlayerIds = currentPlayerIds.filter(
            (playerId, index) => currentPlayerIds.indexOf(playerId) === index
          );
          const nextPlayerNames = nextPlayerIds.map(
            (playerId) => playerNameMap.get(playerId) ?? "Anonymous player"
          );
          transaction.update(lobbyRef, {
            ...(isHost ? { hostDisplayName: trimmedName } : {}),
            playerCount: nextPlayerIds.length,
            playerIds: nextPlayerIds,
            playerNames: nextPlayerNames,
            players: nextPlayerIds.length,
          });
          return;
        }

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
          throw new Error("This lobby is full.");
        }

        const glyph = glyphPool[Math.floor(Math.random() * glyphPool.length)];
        const nextAssignedGlyphs = Array.from(new Set([...assignedGlyphs, glyph]));
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
        currentPlayerIds.push(resolvedUid);
        playerNameMap.set(resolvedUid, trimmedName);
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
          lobbyUpdates.hostDisplayName = trimmedName;
        }

        if (availableGlyphs && availableGlyphs.length > 0) {
          lobbyUpdates.availableGlyphs = availableGlyphs.filter(
            (availableGlyph) => availableGlyph !== glyph
          );
        }

        transaction.set(playerRef, {
          displayName: trimmedName,
          joinedAt: serverTimestamp(),
          isReady: false,
          glyph,
        });
        transaction.update(lobbyRef, lobbyUpdates);
      });

      window.localStorage.setItem(storageKey, trimmedName);
      router.push(`/lobby/${lobbyId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsJoining(false);
    }
  };

  if (!firebaseReady) {
    return (
      <>
        <LoadingSwipeOverlay isVisible={showLoadingOverlay} />
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
      </>
    );
  }

  if (lobbyState === "loading") {
    return (
      <>
        <LoadingSwipeOverlay isVisible={showLoadingOverlay} />
        <div className="notice">
          <strong>Loading lobby...</strong>
        </div>
      </>
    );
  }

  if (lobbyState === "missing") {
    return (
      <>
        <LoadingSwipeOverlay isVisible={showLoadingOverlay} />
        <div className="notice">
          <strong>Lobby not found.</strong>
          <p>This invite link is no longer valid.</p>
        </div>
      </>
    );
  }

  if (lobbyState === "error") {
    return (
      <>
        <LoadingSwipeOverlay isVisible={showLoadingOverlay} />
        <div className="notice">
          <strong>Unable to load lobby.</strong>
          {error ? <p>{error}</p> : null}
        </div>
      </>
    );
  }

  if (!lobby) {
    return null;
  }

  return (
    <>
      <LoadingSwipeOverlay isVisible={showLoadingOverlay} />
      <div className="container">
        <section className="form-card">
          <h2 className="sage-eyebrow-text">Lobby Invite</h2>
          <p>{inviteMessage}</p>
          {canSpectate ? (
            <>
              <p>This lobby&apos;s game has already started.</p>
              <button
                className="form-button-full-width form-card-font"
                type="button"
                onClick={() => router.push(`/game/${lobby.gameId}`)}
              >
                Spectate
              </button>
              {error ? <p className="notice">{error}</p> : null}
            </>
          ) : (
            <form onSubmit={handleJoin}>
              <div className="label-input-grid">
                <label className="form-card-font" htmlFor="invite-username">
                  Name
                </label>
                <input
                  id="invite-username"
                  value={username}
                  className="form-card-font remaining-grid"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Skye"
                />
              </div>
              <button
                className="form-button-full-width form-card-font"
                type="submit"
                disabled={!username.trim() || isJoining}
              >
                {isJoining ? "Joining..." : "Join Lobby"}
              </button>
              {error ? <p className="notice">{error}</p> : null}
            </form>
          )}
        </section>
      </div>
    </>
  );
}
