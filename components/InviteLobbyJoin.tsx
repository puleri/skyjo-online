"use client";

import {
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type UpdateData,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  readStoredUsername,
  useAnonymousAuth,
  usernameStorageKey,
} from "../lib/auth";
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
  source: "party" | "lobby";
};

export default function InviteLobbyJoin({ lobbyId }: InviteLobbyJoinProps) {
  const [lobby, setLobby] = useState<LobbyMeta | null>(null);
  const [lobbyState, setLobbyState] = useState<"loading" | "exists" | "missing" | "error">(
    "loading"
  );
  const [hostName, setHostName] = useState("A player");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(true);
  const {
    uid,
    displayName,
    profileDisplayName,
    isAnonymousUser,
    error: authError,
    signInAsAnonymous,
    saveProfileDisplayName,
  } = useAnonymousAuth();
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

    const partyRef = doc(db, "parties", lobbyId);
    let unsubscribeLegacy: (() => void) | null = null;
    const unsubscribe = onSnapshot(
      partyRef,
      (partySnapshot) => {
        setError(null);
        if (unsubscribeLegacy) {
          unsubscribeLegacy();
          unsubscribeLegacy = null;
        }
        if (partySnapshot.exists()) {
          const data = partySnapshot.data();
          setLobbyState("exists");
          setLobby({
            hostId: (data.hostId as string | undefined) ?? null,
            status: (data.status as string | undefined) ?? "open",
            gameId:
              (data.activeGameId as string | undefined) ??
              (data.gameId as string | undefined) ??
              null,
            source: "party",
          });
          setHostName((data.hostDisplayName as string | undefined) ?? "A player");
          return;
        }

        const legacyLobbyRef = doc(db, "lobbies", lobbyId);
        unsubscribeLegacy = onSnapshot(
          legacyLobbyRef,
          (legacySnapshot) => {
            if (!legacySnapshot.exists()) {
              setLobbyState("missing");
              setLobby(null);
              setHostName("A player");
              return;
            }
            const data = legacySnapshot.data();
            setLobbyState("exists");
            setLobby({
              hostId: (data.hostId as string | undefined) ?? null,
              status: (data.status as string | undefined) ?? "open",
              gameId: (data.gameId as string | undefined) ?? null,
              source: "lobby",
            });
            setHostName((data.hostDisplayName as string | undefined) ?? "A player");
          },
          (err) => {
            setLobbyState("error");
            setError(err.message);
          }
        );
      },
      (err) => {
        setLobbyState("error");
        setError(err.message);
      }
    );

    return () => {
      unsubscribe();
      if (unsubscribeLegacy) {
        unsubscribeLegacy();
      }
    };
  }, [firebaseReady, lobbyId]);

  useEffect(() => {
    if (authError) {
      setError(authError);
    }
  }, [authError]);

  useEffect(() => {
    const nextDisplayName =
      profileDisplayName?.trim() || displayName?.trim() || readStoredUsername() || "";
    setUsername(nextDisplayName);
  }, [displayName, profileDisplayName]);

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
    setJoinSuccess(null);
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

      if (!uid || isAnonymousUser) {
        window.localStorage.setItem(usernameStorageKey, trimmedName);
      } else {
        await saveProfileDisplayName(trimmedName);
      }

      const partyRef = doc(db, "parties", lobbyId);
      const partyMemberRef = doc(db, "parties", lobbyId, "partyMembers", resolvedUid);
      const legacyLobbyRef = doc(db, "lobbies", lobbyId);
      await runTransaction(db, async (transaction) => {
        const partySnapshot = await transaction.get(partyRef);
        const legacyLobbySnapshot = !partySnapshot.exists()
          ? await transaction.get(legacyLobbyRef)
          : null;
        if (!partySnapshot.exists() && !legacyLobbySnapshot?.exists()) {
          throw new Error("This lobby no longer exists.");
        }

        const lobbyData = partySnapshot.exists() ? partySnapshot.data() : legacyLobbySnapshot?.data();
        if (!lobbyData) {
          throw new Error("Lobby details are unavailable.");
        }
        if ((lobbyData.status as string | undefined) === "in-game") {
          const gameId = (lobbyData.gameId as string | undefined) ?? null;
          if (gameId) {
            throw new Error("This lobby is already in a game. Spectate instead.");
          }
          throw new Error("This lobby is already in a game.");
        }

        const playerSnapshot = await transaction.get(partyMemberRef);
        const isHost = (lobbyData.hostId as string | undefined) === resolvedUid;
        if (playerSnapshot.exists()) {
          transaction.update(partyMemberRef, {
            displayName: trimmedName,
            photoURL: null,
            updatedAt: serverTimestamp(),
          });
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
          const partyUpdates = {
            ...(isHost ? { hostDisplayName: trimmedName } : {}),
            playerCount: nextPlayerIds.length,
            memberIds: nextPlayerIds,
            playerIds: nextPlayerIds,
            playerNames: nextPlayerNames,
            players: nextPlayerIds.length,
            updatedAt: serverTimestamp(),
          };
          if (partySnapshot.exists()) {
            transaction.update(partyRef, partyUpdates);
          } else {
            transaction.set(partyRef, {
              ...lobbyData,
              ...partyUpdates,
              status: lobbyData.status ?? "open",
              activeGameId: (lobbyData.gameId as string | undefined) ?? null,
              createdAt: (lobbyData.createdAt as DocumentData | undefined) ?? serverTimestamp(),
            });
          }
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
          memberIds: nextPlayerIds,
          playerIds: nextPlayerIds,
          playerNames: nextPlayerNames,
          players: nextPlayerIds.length,
          updatedAt: serverTimestamp(),
        };
        if (isHost) {
          lobbyUpdates.hostDisplayName = trimmedName;
        }

        if (availableGlyphs && availableGlyphs.length > 0) {
          lobbyUpdates.availableGlyphs = availableGlyphs.filter(
            (availableGlyph) => availableGlyph !== glyph
          );
        }

        transaction.set(partyMemberRef, {
          displayName: trimmedName,
          photoURL: null,
          joinedAt: serverTimestamp(),
          isHost,
        });
        if (partySnapshot.exists()) {
          transaction.update(partyRef, lobbyUpdates);
        } else {
          transaction.set(partyRef, {
            ...lobbyData,
            ...lobbyUpdates,
            status: lobbyData.status ?? "open",
            activeGameId: (lobbyData.gameId as string | undefined) ?? null,
            createdAt: (lobbyData.createdAt as DocumentData | undefined) ?? serverTimestamp(),
          });
        }
      });
      await setDoc(
        doc(db, "users", resolvedUid),
        { activePartyId: lobbyId, updatedAt: serverTimestamp() },
        { merge: true }
      );
      setJoinSuccess("Joined party. You can return to the lobby list.");
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
              {joinSuccess ? <p>{joinSuccess}</p> : null}
              {error ? <p className="notice">{error}</p> : null}
            </form>
          )}
        </section>
      </div>
    </>
  );
}
