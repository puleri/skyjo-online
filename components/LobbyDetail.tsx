"use client";

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousAuth } from "../lib/auth";
import { GLYPHS } from "../lib/constants";
import { createItemCards, createSkyjoDeck, shuffleDeck } from "../lib/game/deck";
import type { SpikeItemCount } from "../lib/game/deck";
import type { Card } from "../lib/game/deck";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";
import LoadingSwipeOverlay from "./LoadingSwipeOverlay";

type LobbyPlayer = {
  id: string;
  displayName: string;
  isReady: boolean;
  glyph: string;
};

type LobbyDetailProps = {
  lobbyId: string;
};

type LobbyMeta = {
  hostId: string | null;
  gameId: string | null;
  status: string;
  spikeMode: boolean;
  spikeItemCount?: SpikeItemCount;
  spikeRowClear?: boolean;
};

const backgroundMusicStorageKey = "skyjo-background-music";

export default function LobbyDetail({ lobbyId }: LobbyDetailProps) {
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [lobby, setLobby] = useState<LobbyMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(true);
  const [isBackgroundMusicEnabled] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(backgroundMusicStorageKey) === "true";
  });
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const { uid, error: authError } = useAnonymousAuth();
  const firebaseReady = isFirebaseConfigured;
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!isBackgroundMusicEnabled) {
      return;
    }

    const audioUrl = "/sounds/theme/main-theme-loop.wav";
    const audioContext = new AudioContext();
    const gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
    audioContextRef.current = audioContext;

    let isActive = true;
    const abortController = new AbortController();

    const handleResume = () => {
      audioContext.resume().catch(() => undefined);
    };

    window.addEventListener("click", handleResume, { once: true });
    window.addEventListener("keydown", handleResume, { once: true });
    window.addEventListener("touchstart", handleResume, { once: true });

    fetch(audioUrl, { signal: abortController.signal })
      .then((response) => response.arrayBuffer())
      .then((buffer) => audioContext.decodeAudioData(buffer))
      .then((decodedBuffer) => {
        if (!isActive) {
          return;
        }
        const source = audioContext.createBufferSource();
        source.buffer = decodedBuffer;
        source.loop = true;
        source.connect(gainNode);
        source.start(0);
        audioSourceRef.current = source;
      })
      .catch(() => undefined);

    return () => {
      isActive = false;
      abortController.abort();
      audioSourceRef.current?.stop();
      audioSourceRef.current?.disconnect();
      audioSourceRef.current = null;
      gainNode.disconnect();
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, [isBackgroundMusicEnabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowLoadingOverlay(false);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!firebaseReady || !lobbyId) {
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
          glyph: (doc.data().glyph as string | undefined) ?? "player-glyph-sun",
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
          gameId: (data.gameId as string | undefined) ?? null,
          status: (data.status as string | undefined) ?? "open",
          spikeMode: Boolean(data.spikeMode),
          spikeItemCount: (data.spikeItemCount as SpikeItemCount | undefined) ?? "low",
          spikeRowClear: Boolean(data.spikeRowClear),
        });
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

  useEffect(() => {
    if (lobby?.gameId) {
      router.push(`/game/${lobby.gameId}`);
    }
  }, [lobby?.gameId, router]);

  const currentPlayer = useMemo(
    () => (uid ? players.find((player) => player.id === uid) ?? null : null),
    [players, uid]
  );
  const isHost = Boolean(uid && lobby?.hostId && uid === lobby.hostId);
  const hostPlayer = useMemo(
    () => (lobby?.hostId ? players.find((player) => player.id === lobby.hostId) ?? null : null),
    [players, lobby?.hostId]
  );
  const allPlayersReady = players.length > 0 && players.every((player) => player.isReady);
  const inviteLink =
    typeof window === "undefined" ? "" : `${window.location.origin}/invite/${lobbyId}`;

  const handleCopyInvite = async () => {
    if (!inviteLink) {
      setInviteStatus("Invite link unavailable.");
      return;
    }

    setInviteStatus(null);
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteStatus("Invite link copied!");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to copy invite link.";
      setInviteStatus(message);
    }
  };

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

  const handleStartGame = async () => {
    if (!uid) {
      setError("Sign in to start a game.");
      return;
    }
    if (!isHost) {
      setError("Only the host can start the game.");
      return;
    }
    if (!allPlayersReady) {
      setError("All players must be ready to start.");
      return;
    }

    setIsStarting(true);
    setError(null);
    try {
      const lobbyRef = doc(db, "lobbies", lobbyId);
      const gameRef = doc(collection(db, "games"));
      await runTransaction(db, async (transaction) => {
        const lobbySnap = await transaction.get(lobbyRef);
        if (!lobbySnap.exists()) {
          throw new Error("Lobby not found.");
        }
        const lobbyData = lobbySnap.data();
        const spikeMode = Boolean(lobbyData.spikeMode);
        const spikeItemCount = (lobbyData.spikeItemCount as SpikeItemCount | undefined) ?? "low";
        const spikeRowClear = Boolean(lobbyData.spikeRowClear);
        const playerQuery = query(
          collection(db, "lobbies", lobbyId, "players"),
          orderBy("joinedAt", "asc")
        );
        const playerSnapshot = await getDocs(playerQuery);
        if (playerSnapshot.empty) {
          throw new Error("Add at least one player before starting.");
        }

        const playerOrder = playerSnapshot.docs.map((playerDoc) => playerDoc.id);
        let shuffledDeck: Card[] = shuffleDeck(createSkyjoDeck());
        const playerGrids = new Map<string, number[]>();
        playerOrder.forEach((playerId) => {
          const grid: number[] = [];
          for (let i = 0; i < 12; i += 1) {
            const card = shuffledDeck.pop();
            if (typeof card !== "number") {
              throw new Error("Not enough cards to deal the opening hands.");
            }
            grid.push(card);
          }
          playerGrids.set(playerId, grid);
        });

        if (spikeMode) {
          shuffledDeck = shuffleDeck([...shuffledDeck, ...createItemCards(spikeItemCount)]);
        }

        const discardCard = shuffledDeck.pop();
        if (discardCard === undefined) {
          throw new Error("Deck is empty after dealing.");
        }
        const startingPlayerId =
          playerOrder[Math.floor(Math.random() * playerOrder.length)] ?? playerOrder[0];

        transaction.set(gameRef, {
          status: "playing",
          lobbyId,
          hostId: uid,
          roundNumber: 1,
          currentPlayerId: startingPlayerId,
          activePlayerOrder: playerOrder,
          turnPhase: "choose-draw",
          deck: shuffledDeck,
          discard: [discardCard],
          graveyard: [],
          spikeMode,
          ...(spikeMode ? { spikeItemCount, spikeRowClear } : {}),
          lastTurnPlayerId: null,
          lastTurnAction: null,
          lastTurnActionAt: null,
          createdAt: serverTimestamp(),
        });

        playerSnapshot.docs.forEach((playerDoc, index) => {
          const data = playerDoc.data();
          transaction.set(doc(db, "games", gameRef.id, "players", playerDoc.id), {
            displayName: data.displayName ?? "Anonymous player",
            seatIndex: index,
            grid: playerGrids.get(playerDoc.id) ?? [],
            revealed: Array.from({ length: 12 }, () => false),
            isReady: false,
            roundScore: 0,
            totalScore: 0,
          });
        });

        transaction.update(lobbyRef, { status: "in-game", gameId: gameRef.id });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsStarting(false);
    }
  };

  if (!lobbyId) {
    return (
      <>
        <LoadingSwipeOverlay isVisible={showLoadingOverlay} />
        <div className="notice">
          <strong>Loading lobby...</strong>
          <p>Waiting for a lobby ID before connecting to Firestore.</p>
        </div>
      </>
    );
  }

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

  return (
    <div className="lobby-detail">
      <LoadingSwipeOverlay isVisible={showLoadingOverlay} />
      {error ? <p className="notice">Firestore error: {error}</p> : null}

      {!players.length ? (
        <p>No players have joined this lobby yet.</p>
      ) : (
        <div className="lobby-scene-wrapper">
          <div className="lobby-scene" aria-label="Lobby players">
            {players.map((player) => (
              <div key={player.id} className="lobby-player">
                <img
                  className="lobby-player__glyph"
                  src={`/glyphs/${player.glyph}.svg`}
                  alt={`${player.displayName} glyph`}
                />
                <img
                  className="lobby-player__platform"
                  src="/glyphs/player-glyph-platform.svg"
                  alt=""
                  aria-hidden="true"
                />
                <span className="lobby-player__name">
                  {player.displayName}
                  {player.isReady ? (
                    <span className="lobby-player__ready" aria-label="Ready">
                      ✓
                    </span>
                  ) : null}
                </span>
              </div>
            ))}

          </div>
          <div className="lobby-detail__actions">
            <button
              type="button"
              className={`form-button-full-width ${currentPlayer?.isReady ? "ready" : ""}`}
              onClick={handleToggleReady}
              disabled={!uid || !currentPlayer || isUpdating}
            >
              {isUpdating
                ? "Updating..."
                : currentPlayer?.isReady
                  ? `✓ Ready`
                  : "Ready"}
            </button>
            <button
              type="button"
              className="form-button-full-width"
              onClick={handleCopyInvite}
              disabled={!inviteLink}
            >
              Copy invite link
            </button>
            {inviteStatus ? <p className="lobby-detail__invite-status">{inviteStatus}</p> : null}
            {isHost ? (
              <button
                type="button"
                className="form-button-full-width"
                onClick={handleStartGame}
                disabled={!allPlayersReady || isStarting}
              >
                {isStarting ? "Starting..." : "Start game"}
              </button>
            ) : (
              <p className="lobby-detail__waiting">
                Once players are ready, <strong>{hostPlayer?.displayName ?? "the host"}</strong> can start the game.
              </p>
            )}
          </div>
        </div>

      )}
    </div>
  );
}
