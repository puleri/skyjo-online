"use client";

import {
  doc,
  onSnapshot,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  readStoredUsername,
  useAnonymousAuth,
  usernameStorageKey,
} from "../lib/auth";
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
  const shouldRouteHomeAfterJoinRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowLoadingOverlay(false);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const hasInternalReferrer = document.referrer.startsWith(window.location.origin);
    const openedDirectly = !hasInternalReferrer && window.history.length <= 1;
    shouldRouteHomeAfterJoinRef.current = openedDirectly;
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
    const unsubscribe = onSnapshot(
      partyRef,
      (partySnapshot) => {
        setError(null);
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
          });
          setHostName((data.hostDisplayName as string | undefined) ?? "A player");
          return;
        }
        setLobbyState("missing");
        setLobby(null);
        setHostName("A player");
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
      const partySnapshot = await getDoc(partyRef);
      if (!partySnapshot.exists()) {
        throw new Error("This lobby no longer exists.");
      }

      const partyData = partySnapshot.data();
      if ((partyData.status as string | undefined) === "in-game") {
        const gameId =
          (partyData.activeGameId as string | undefined) ??
          (partyData.gameId as string | undefined) ??
          null;
        if (gameId) {
          throw new Error("This lobby is already in a game. Spectate instead.");
        }
        throw new Error("This lobby is already in a game.");
      }

      const existingMemberSnapshot = await getDoc(partyMemberRef);
      const isHost = (partyData.hostId as string | undefined) === resolvedUid;
      if (existingMemberSnapshot.exists()) {
        await setDoc(
          partyMemberRef,
          {
            displayName: trimmedName,
            photoURL: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        await setDoc(partyMemberRef, {
          displayName: trimmedName,
          photoURL: null,
          joinedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          isHost,
        });
      }

      await setDoc(
        doc(db, "users", resolvedUid),
        { activePartyId: lobbyId, updatedAt: serverTimestamp() },
        { merge: true }
      );
      setJoinSuccess("Joined party.");
      if (shouldRouteHomeAfterJoinRef.current) {
        router.replace("/");
      }
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
