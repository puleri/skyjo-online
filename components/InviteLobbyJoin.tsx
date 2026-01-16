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
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousAuth } from "../lib/auth";
import { GLYPHS } from "../lib/constants";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

type InviteLobbyJoinProps = {
  lobbyId: string;
};

type LobbyMeta = {
  hostId: string | null;
  status: string;
};

const storageKey = "skyjo:username";

export default function InviteLobbyJoin({ lobbyId }: InviteLobbyJoinProps) {
  const [lobby, setLobby] = useState<LobbyMeta | null>(null);
  const [hostName, setHostName] = useState("A player");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const { uid, error: authError } = useAnonymousAuth();
  const firebaseReady = isFirebaseConfigured;
  const router = useRouter();

  useEffect(() => {
    if (!firebaseReady || !lobbyId) {
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
    if (!firebaseReady || !lobby?.hostId || !lobbyId) {
      return;
    }

    const hostRef = doc(db, "lobbies", lobbyId, "players", lobby.hostId);
    const unsubscribe = onSnapshot(
      hostRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setHostName("A player");
          return;
        }
        setHostName((snapshot.data().displayName as string | undefined) ?? "A player");
      },
      () => {
        setHostName("A player");
      }
    );

    return () => unsubscribe();
  }, [firebaseReady, lobby?.hostId, lobbyId]);

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
    () => `${hostName} invited you to their skyjo lobby, please make a username first`,
    [hostName]
  );

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!uid) {
      setError("Sign in to join the lobby.");
      return;
    }

    const trimmedName = username.trim();
    if (!trimmedName) {
      setError("Enter a username before joining.");
      return;
    }

    setIsJoining(true);
    setError(null);
    try {
      const lobbyRef = doc(db, "lobbies", lobbyId);
      const playerRef = doc(db, "lobbies", lobbyId, "players", uid);
      await runTransaction(db, async (transaction) => {
        const lobbySnapshot = await transaction.get(lobbyRef);
        if (!lobbySnapshot.exists()) {
          throw new Error("This lobby no longer exists.");
        }

        const lobbyData = lobbySnapshot.data();
        if ((lobbyData.status as string | undefined) === "in-game") {
          throw new Error("This lobby is already in a game.");
        }

        const playerSnapshot = await transaction.get(playerRef);
        if (playerSnapshot.exists()) {
          transaction.update(playerRef, { displayName: trimmedName });
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
        const lobbyUpdates: UpdateData<DocumentData> = {
          assignedGlyphs: nextAssignedGlyphs,
        };

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

  if (!lobby) {
    return (
      <div className="notice">
        <strong>Lobby not found.</strong>
        <p>This invite link is no longer valid.</p>
      </div>
    );
  }

  return (
    <div className="container">
      <section className="form-card">
        <h2 className="charcoal-eyebrow-text">Lobby Invite</h2>
        <p>{inviteMessage}</p>
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
      </section>
    </div>
  );
}
