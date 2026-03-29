"use client";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { readStoredUsername, resolvePlayerDisplayName, useAnonymousAuth } from "../lib/auth";
import { usePreferences } from "../lib/preferences";
import CreateLobbyForm from "./CreateLobbyForm";
import PartyInviteModal from "./PartyInviteModal";
import SnowfallLayer from "./SnowfallLayer";
import {
  db,
  isFirebaseConfigured,
  missingFirebaseConfig,
} from "../lib/firebase";
import { useUserProfile } from "../lib/useUserProfile";
import { startSoloGameAction } from "../lib/partyActions";
import { MIN_PARTY_SIZE_TO_START, type PreGameConfig, useParty } from "./LobbyProvider";

type LeaderboardEntry = {
  id: string;
  displayName: string;
  score: number;
  gameId?: string | null;
  playerId?: string | null;
};

function isLeaderboardEntryActive(expiresAt: unknown) {
  return expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now();
}

export default function LobbyScreen() {
  const router = useRouter();
  const { preferences } = usePreferences();
  const {
    profile,
    authDisplayName,
    isSignedIn,
  } = useUserProfile();
  const {
    snow: isSnowEnabled,
  } = preferences;
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<
    LeaderboardEntry[]
  >([]);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [isCreatingClassiqueParty, setIsCreatingClassiqueParty] = useState(false);
  const [classiqueError, setClassiqueError] = useState<string | null>(null);
  const [isCreatingQuickplayParty, setIsCreatingQuickplayParty] = useState(false);
  const [quickplayError, setQuickplayError] = useState<string | null>(null);
  const firebaseReady = isFirebaseConfigured;
  const leaderboardTriggerRef = useRef<HTMLButtonElement | null>(null);
  const leaderboardCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasLeaderboardOpen = useRef(false);
  const { uid, isAnonymousUser } = useAnonymousAuth();
  const { partyId, party, members, isHost, startGame, setPreGameConfig, pendingJoinError } = useParty();
  const isPartyGuest = Boolean(partyId && !isHost);

  useEffect(() => {
    if (!firebaseReady) {
      setLeaderboardEntries([]);
      setLeaderboardError(null);
      return;
    }

    if (!isLeaderboardOpen) {
      return;
    }

    const leaderboardQuery = query(
      collection(db, "leaderboard"),
      orderBy("score", "asc"),
    );
    const unsubscribe = onSnapshot(
      leaderboardQuery,
      (snapshot) => {
        const expiredEntries = snapshot.docs.filter(
          (entry) => !isLeaderboardEntryActive(entry.data().expiresAt),
        );
        if (expiredEntries.length) {
          void Promise.all(
            expiredEntries.map((entry) => deleteDoc(entry.ref)),
          ).catch((err: Error) => setLeaderboardError(err.message));
        }

        setLeaderboardEntries(
          snapshot.docs
            .filter((entry) => isLeaderboardEntryActive(entry.data().expiresAt))
            .slice(0, 10)
            .map((entry) => {
              const data = entry.data();
              return {
                id: entry.id,
                displayName:
                  (data.displayName as string | undefined) ??
                  "Anonymous player",
                score: (data.score as number | undefined) ?? 0,
                gameId: (data.gameId as string | null | undefined) ?? null,
                playerId: (data.playerId as string | null | undefined) ?? null,
              };
            }),
        );
        setLeaderboardError(null);
      },
      (err) => {
        setLeaderboardError(err.message);
      },
    );

    return () => unsubscribe();
  }, [firebaseReady, isLeaderboardOpen]);

  useEffect(() => {
    if (isLeaderboardOpen) {
      leaderboardCloseButtonRef.current?.focus();
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setIsLeaderboardOpen(false);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      wasLeaderboardOpen.current = true;
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }

    if (wasLeaderboardOpen.current) {
      leaderboardTriggerRef.current?.focus();
    }
    wasLeaderboardOpen.current = false;
  }, [isLeaderboardOpen]);

  const handleCreateClassiqueParty = async (targetScore: 50 | 100) => {
    const isQuickplay = targetScore === 50;
    const modeName = isQuickplay ? "Quickplay" : "Classique";
    if (!uid) {
      const message = `Sign in to create a ${modeName} party.`;
      if (isQuickplay) {
        setQuickplayError(message);
      } else {
        setClassiqueError(message);
      }
      return;
    }

    if (partyId && party) {
      if (!isHost) {
        const message = `Only the party host can start ${modeName}.`;
        if (isQuickplay) {
          setQuickplayError(message);
        } else {
          setClassiqueError(message);
        }
        return;
      }

      if (members.length < MIN_PARTY_SIZE_TO_START) {
        const message = `Need at least ${MIN_PARTY_SIZE_TO_START} players to start ${modeName}.`;
        if (isQuickplay) {
          setQuickplayError(message);
        } else {
          setClassiqueError(message);
        }
        return;
      }

      const classiqueConfig: PreGameConfig = {
        gameType: "spike",
        spikeMode: true,
        spikeItemCount: "high",
        spikeRowClear: true,
        spikeEndGameBonuses: true,
        targetScore,
      };

      if (isQuickplay) {
        setIsCreatingQuickplayParty(true);
        setQuickplayError(null);
      } else {
        setIsCreatingClassiqueParty(true);
        setClassiqueError(null);
      }
      try {
        await setPreGameConfig(classiqueConfig);
        await startGame();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : `Unable to start a ${modeName} game right now.`;
        if (isQuickplay) {
          setQuickplayError(message);
        } else {
          setClassiqueError(message);
        }
      } finally {
        if (isQuickplay) {
          setIsCreatingQuickplayParty(false);
        } else {
          setIsCreatingClassiqueParty(false);
        }
      }
      return;
    }

    const resolvedName = resolvePlayerDisplayName({
      profileDisplayName: profile?.displayName ?? null,
      authDisplayName,
      storedDisplayName: readStoredUsername(),
    });
    if (isQuickplay) {
      setIsCreatingQuickplayParty(true);
      setQuickplayError(null);
    } else {
      setIsCreatingClassiqueParty(true);
      setClassiqueError(null);
    }
    try {
      const gameId = await startSoloGameAction({
        db,
        callerUid: uid,
        playerDisplayName: resolvedName,
        preGameConfig: {
          gameType: "spike",
          spikeMode: true,
          spikeItemCount: "high",
          spikeRowClear: true,
          spikeEndGameBonuses: true,
          targetScore,
        },
      });

      router.push(`/game/${gameId}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Unable to start a ${modeName} game right now.`;
      if (isQuickplay) {
        setQuickplayError(message);
      } else {
        setClassiqueError(message);
      }
    } finally {
      if (isQuickplay) {
        setIsCreatingQuickplayParty(false);
      } else {
        setIsCreatingClassiqueParty(false);
      }
    }
  };

  const podiumLabels = ["1st", "2nd", "3rd"];

  return (
    <main>
      {isSnowEnabled ? <SnowfallLayer height={"180%"} /> : null}

      <div className="container">
        {pendingJoinError ? (
          <p className="notice" role="status">
            Couldn&apos;t join invite: {pendingJoinError}
          </p>
        ) : null}
        <div className="flex-space-between">
          <img className="home-logo" src="/images/misty-logo.svg" alt="Misty logo" />
          {/* when this button is clicked, it opens the rules image in another window */}
          <div className="menu-action-buttons">
            <button
              type="button"
              className="menu-action-button"
              aria-label="Open leaderboard"
              aria-haspopup="dialog"
              ref={leaderboardTriggerRef}
              onClick={() => setIsLeaderboardOpen(true)}
              disabled={isAnonymousUser}
            >
              <img
                className="settings-icon"
                src="/leaderboard-icon.png"
                alt="Leaderboard icon"
              />
            </button>
            <Link
              href="/rules"
              className="menu-action-button"
              aria-label="Open game rules"
            >
              <img
                className="question-mark-icon"
                src="/question-mark-icon.png"
                alt="Misty Instructions Menu Icon"
              />
            </Link>
          </div>
        </div>

        <div className="form-card">
          {isSignedIn ? (
            <div className="lobby-bento-grid">
              <button
                type="button"
                className="home-menu-button_main-row home-menu-buttons home-menu-buttons--classique lobby-bento-grid__classique"
                onClick={() => void handleCreateClassiqueParty(100)}
                disabled={
                  !firebaseReady ||
                  isAnonymousUser ||
                  isCreatingClassiqueParty ||
                  isCreatingQuickplayParty ||
                  isPartyGuest
                }
              >
 <img src="/text/Classique.svg" alt="Classique" className="home-menu-words" />              </button>
              <button
                type="button"
                className="home-menu-button_main-row home-menu-buttons home-menu-buttons--quickplay lobby-bento-grid__quickplay"
                onClick={() => void handleCreateClassiqueParty(50)}
                disabled={
                  !firebaseReady ||
                  isCreatingClassiqueParty ||
                  isCreatingQuickplayParty ||
                  isPartyGuest
                }
              >
                 <img src="/text/Quickplay.svg" alt="Quickplay" className="home-menu-words" />
              </button>
              <button
                type="button"
                className="home-menu-buttons home-menu-buttons--experimental experimental-button lobby-bento-grid__experimental"
                disabled
              >
                <img src="/text/Experimental.svg" alt="Experimental" className="home-menu-words" />
              </button>
              <button
                type="button"
                className="home-menu-buttons home-menu-buttons--shop shop-button lobby-bento-grid__shop"
                disabled
              >
                <img src="/text/Shop.svg" alt="Shop" className="home-menu-words-shop" />

              </button>
            </div>
          ) : null}
          {isSignedIn ? (
            <>
              {isAnonymousUser ? <p className="notice">Quickplay is available for guest users. Sign in to unlock Classique and Leaderboard.</p> : null}
              {classiqueError ? <p className="notice">{classiqueError}</p> : null}
              {quickplayError ? <p className="notice">{quickplayError}</p> : null}
            </>
          ) : null}
        </div>
        <PartyInviteModal />

        {isLeaderboardOpen ? (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leaderboard-title"
            onClick={() => setIsLeaderboardOpen(false)}
          >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <h3 id="leaderboard-title">Leaderboard</h3>
              <p className="leaderboard-sub mb-0">
                Lowest 10 scores of the season.
              </p>
              <p className="leaderboard-sub text-xs">
                Entries expire after 90 days
              </p>

              {!firebaseReady ? (
                <p>
                  Provide your Firebase environment variables to load
                  leaderboard results. Missing keys:{" "}
                  {missingFirebaseConfig.length
                    ? missingFirebaseConfig.join(", ")
                    : "Unknown (restart the dev server)."}
                </p>
              ) : leaderboardError ? (
                <p>Firestore error: {leaderboardError}</p>
              ) : leaderboardEntries.length ? (
                <ol className="leaderboard-list">
                  {leaderboardEntries.map((entry, index) => {
                    const isPodium = index < podiumLabels.length;

                    return (
                      <li key={entry.id} className="leaderboard-list__item">
                        {isPodium ? (
                          <span
                            className={`leaderboard-list__badge leaderboard-list__badge--${index + 1}`}
                            aria-label={`${podiumLabels[index]} place`}
                          >
                            {podiumLabels[index]}
                          </span>
                        ) : (
                          <span className="leaderboard-list__rank">
                            {index + 1}.
                          </span>
                        )}
                        <span className="leaderboard-list__name">
                          {entry.displayName}
                        </span>
                        <span className="leaderboard-list__score">
                          {entry.score}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="tiny-bold">
                  No scores yet. Finish a game to claim a spot!
                </p>
              )}
              <div className="modal__actions">
                <button
                  className="form-button-full-width"
                  type="button"
                  ref={leaderboardCloseButtonRef}
                  onClick={() => setIsLeaderboardOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
