"use client";

import {
  collection,
  doc,
  getDoc,
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
import { readStoredUsername, resolvePlayerDisplayName, useAnonymousAuth } from "../lib/auth";
import { GLYPHS } from "../lib/constants";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";
import type { SpikeItemCount } from "../lib/game/deck";
import {
  endGameBonusesLabel,
  getSpikeItemCountLabel,
  rowClearLabel,
} from "../lib/game/modeLabels";

type Lobby = {
  id: string;
  name: string;
  status: string;
  players: number;
};

type LobbyPreview = {
  id: string;
  name: string;
  spikeMode: boolean;
  spikeItemCount?: SpikeItemCount;
  spikeRowClear?: boolean;
  spikeEndGameBonuses?: boolean;
  players: string[];
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
  const [selectedLobbyId, setSelectedLobbyId] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewCache, setPreviewCache] = useState<Record<string, LobbyPreview>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const { uid, displayName, profileDisplayName, error: authError } = useAnonymousAuth();
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
        const nextLobbies = snapshot.docs
          .filter((doc) => !Boolean(doc.data().isPrivate))
          .map((doc) => ({
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

  useEffect(() => {
    if (!isPreviewOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPreviewOpen(false);
        setSelectedLobbyId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPreviewOpen]);

  const closePreview = () => {
    setIsPreviewOpen(false);
    setSelectedLobbyId(null);
  };

  const fetchLobbyPreview = async (lobby: Lobby) => {
    if (previewCache[lobby.id]) {
      return;
    }
    setIsPreviewLoading(true);
    setPreviewError(null);
    try {
      const lobbyRef = doc(db, "lobbies", lobby.id);
      const playersRef = collection(db, "lobbies", lobby.id, "players");
      const [lobbySnapshot, playersSnapshot] = await Promise.all([
        getDoc(lobbyRef),
        getDocs(playersRef),
      ]);
      if (!lobbySnapshot.exists()) {
        throw new Error("Lobby details are no longer available.");
      }
      const lobbyData = lobbySnapshot.data();
      const spikeItemCount = (lobbyData.spikeItemCount as SpikeItemCount | undefined) ?? "low";
      const preview: LobbyPreview = {
        id: lobby.id,
        name: lobbyData.name ?? lobby.name ?? "Untitled lobby",
        spikeMode: Boolean(lobbyData.spikeMode),
        spikeItemCount,
        spikeRowClear: Boolean(lobbyData.spikeRowClear),
        spikeEndGameBonuses: (lobbyData.spikeEndGameBonuses as boolean | undefined) ?? true,
        players: playersSnapshot.docs.map(
          (player) => player.data().displayName ?? "Anonymous player"
        ),
      };
      setPreviewCache((current) => ({ ...current, [lobby.id]: preview }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setPreviewError(message);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const openPreview = (lobby: Lobby) => {
    setSelectedLobbyId(lobby.id);
    setIsPreviewOpen(true);
    void fetchLobbyPreview(lobby);
  };

  const handleJoin = async (lobbyId: string) => {
    if (!uid) {
      setError("Unable to join a lobby without a signed-in user.");
      return;
    }

    closePreview();
    setJoiningLobbyId(lobbyId);
    setError(null);
    try {
      const resolvedName = resolvePlayerDisplayName({
        profileDisplayName,
        authDisplayName: displayName,
        storedDisplayName: readStoredUsername(),
      });
      const lobbyRef = doc(db, "lobbies", lobbyId);
      const playerRef = doc(db, "lobbies", lobbyId, "players", uid);
      await runTransaction(db, async (transaction) => {
        const lobbySnapshot = await transaction.get(lobbyRef);
        if (!lobbySnapshot.exists()) {
          throw new Error("This lobby no longer exists.");
        }

        const lobbyData = lobbySnapshot.data();
        const playerDisplayName = resolvedName;
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
        playerNameMap.set(uid, playerDisplayName);
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
        };
        if (isHost) {
          lobbyUpdates.hostDisplayName = playerDisplayName;
        }

        if (!isExistingPlayer && availableGlyphs && availableGlyphs.length > 0) {
          lobbyUpdates.availableGlyphs = availableGlyphs.filter(
            (availableGlyph) => availableGlyph !== glyph
          );
        }

        if (isExistingPlayer) {
          transaction.update(playerRef, { displayName: playerDisplayName });
        } else {
          transaction.set(playerRef, {
            displayName: playerDisplayName,
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
  const activePreview = selectedLobbyId ? previewCache[selectedLobbyId] : null;
  const spikeItemLabel = activePreview
    ? getSpikeItemCountLabel(activePreview.spikeItemCount).replace(" items", "")
    : "";
  const rowClearStatus = activePreview?.spikeRowClear
    ? `${rowClearLabel}`
    : ``;
  const bonusStatus = activePreview?.spikeEndGameBonuses
    ? endGameBonusesLabel
    : "";
  const modeDetails = activePreview?.spikeMode
    ? ["Spike", spikeItemLabel, rowClearStatus, bonusStatus].filter(Boolean).join(" • ")
    : "Classic";

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
              <div className="lobby-header-preview-wrapper">
                  <button
                  className="lobby-preview-button"
                  tabIndex={0}
                  onClick={() => openPreview(lobby)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openPreview(lobby);
                    }
                  }}
                > <img className="eye-icon" src="/info-icon.png" alt="" aria-hidden="true" />
                </button>
              <strong className="name-lobby-list">{lobby.name}</strong>

              </div>

              <div className="relative">
                <button
                  type="button"
                  className={buttonClassName}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleJoin(lobby.id);
                  }}
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
      {isPreviewOpen ? (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closePreview();
            }
          }}
        >
          <div className="preview-lobby-modal">
            <h3 className="leaderboard-title lobby-preview-title">Lobby Preview</h3>
            <h3 className="lobby-preview-subtitle">{activePreview?.name ?? "Lobby preview"}
              <span className="mode-preview">{modeDetails ?? "Mode details unavailable"}</span>
            </h3>
            {previewError ? <p className="notice">{previewError}</p> : null}
            {isPreviewLoading && !activePreview ? <p>Loading preview…</p> : null}
            {activePreview ? (
              <>
  
                {activePreview.players.length ? (
                  <ul>
                    {activePreview.players.map((player) => (
                      <li className="players-preview" key={player}>{player}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No players yet.</p>
                )}
              </>
            ) : null}
            <button
            onClick={() => closePreview()}
            className="form-button-full-width mt-20"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
