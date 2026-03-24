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
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured } from "../lib/firebase";
import {
  createMistyDeck,
  shuffleDeck,
  shuffleDeckWithDelayedSwapCards,
  type Card,
  type SpikeItemCount,
} from "../lib/game/deck";

type GameType = "classic" | "spike";

type Party = {
  id: string;
  hostId: string | null;
  hostDisplayName: string | null;
  status: string;
  activeGameId: string | null;
  spikeMode: boolean;
  spikeItemCount: SpikeItemCount;
  spikeRowClear: boolean;
  spikeEndGameBonuses: boolean;
};

type PartyMember = {
  id: string;
  displayName: string;
  photoURL: string | null;
  isHost: boolean;
  joinedAt?: unknown;
};

type PartyContextValue = {
  partyId: string | null;
  party: Party | null;
  members: PartyMember[];
  isHost: boolean;
  loading: boolean;
  invite: () => Promise<string>;
  leave: () => Promise<void>;
  setGameType: (gameType: GameType) => Promise<void>;
  startGame: () => Promise<void>;
  setActivePartyId: (nextPartyId: string | null) => Promise<void>;
};

const PartyContext = createContext<PartyContextValue | null>(null);

function toParty(id: string, data: Record<string, unknown>): Party {
  return {
    id,
    hostId: typeof data.hostId === "string" ? data.hostId : null,
    hostDisplayName: typeof data.hostDisplayName === "string" ? data.hostDisplayName : null,
    status: typeof data.status === "string" ? data.status : "open",
    activeGameId:
      typeof data.activeGameId === "string"
        ? data.activeGameId
        : typeof data.gameId === "string"
          ? data.gameId
          : null,
    spikeMode: Boolean(data.spikeMode),
    spikeItemCount: (data.spikeItemCount as SpikeItemCount | undefined) ?? "low",
    spikeRowClear: Boolean(data.spikeRowClear),
    spikeEndGameBonuses: (data.spikeEndGameBonuses as boolean | undefined) ?? true,
  };
}

export default function LobbyProvider({ children }: { children: ReactNode }) {
  const { uid } = useAnonymousAuth();
  const [partyId, setPartyId] = useState<string | null>(null);
  const [party, setParty] = useState<Party | null>(null);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [loadingUser, setLoadingUser] = useState(true);
  const [loadingParty, setLoadingParty] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured || !uid) {
      setPartyId(null);
      setParty(null);
      setMembers([]);
      setLoadingUser(false);
      return;
    }

    setLoadingUser(true);
    const unsubscribe = onSnapshot(doc(db, "users", uid), (snapshot) => {
      const nextPartyId = snapshot.exists() ? (snapshot.data().activePartyId as string | undefined) ?? null : null;
      setPartyId(nextPartyId);
      setLoadingUser(false);
    });

    return () => unsubscribe();
  }, [uid]);

  useEffect(() => {
    if (!isFirebaseConfigured || !partyId) {
      setParty(null);
      setMembers([]);
      setLoadingParty(false);
      return;
    }

    setLoadingParty(true);
    const partyRef = doc(db, "parties", partyId);
    const membersRef = query(collection(db, "parties", partyId, "partyMembers"), orderBy("joinedAt", "asc"));

    const unsubscribeParty = onSnapshot(partyRef, (snapshot) => {
      if (!snapshot.exists()) {
        setParty(null);
        setLoadingParty(false);
        return;
      }

      setParty(toParty(snapshot.id, snapshot.data() as Record<string, unknown>));
      setLoadingParty(false);
    });

    const unsubscribeMembers = onSnapshot(membersRef, (snapshot) => {
      setMembers(
        snapshot.docs.map((memberDoc) => ({
          id: memberDoc.id,
          displayName: (memberDoc.data().displayName as string | undefined) ?? "Anonymous player",
          photoURL: (memberDoc.data().photoURL as string | undefined) ?? null,
          isHost: Boolean(memberDoc.data().isHost),
          joinedAt: memberDoc.data().joinedAt,
        })),
      );
    });

    return () => {
      unsubscribeParty();
      unsubscribeMembers();
    };
  }, [partyId]);

  const setActivePartyId = useCallback(
    async (nextPartyId: string | null) => {
      if (!uid) {
        throw new Error("Sign in before selecting a party.");
      }

      await setDoc(
        doc(db, "users", uid),
        {
          activePartyId: nextPartyId,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    },
    [uid],
  );

  const invite = useCallback(async () => {
    if (!partyId) {
      throw new Error("No active party to invite players to.");
    }
    if (typeof window === "undefined") {
      throw new Error("Invite links are only available in the browser.");
    }

    const inviteLink = `${window.location.origin}/invite/${partyId}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(inviteLink);
    }

    return inviteLink;
  }, [partyId]);

  const leave = useCallback(async () => {
    if (!uid || !partyId) {
      return;
    }

    const partyRef = doc(db, "parties", partyId);
    const memberRef = doc(db, "parties", partyId, "partyMembers", uid);

    await runTransaction(db, async (transaction) => {
      const [partySnap, membersSnap] = await Promise.all([
        transaction.get(partyRef),
        getDocs(query(collection(db, "parties", partyId, "partyMembers"), orderBy("joinedAt", "asc"))),
      ]);
      if (!partySnap.exists()) {
        return;
      }

      const partyData = partySnap.data();
      const nextMembers = membersSnap.docs
        .filter((memberDoc) => memberDoc.id !== uid)
        .map((memberDoc) => ({
          id: memberDoc.id,
          displayName: (memberDoc.data().displayName as string | undefined) ?? "Anonymous player",
        }));

      transaction.delete(memberRef);
      if (!nextMembers.length) {
        transaction.delete(partyRef);
        return;
      }

      const nextHostId = partyData.hostId === uid ? nextMembers[0]?.id ?? null : ((partyData.hostId as string | undefined) ?? null);
      const nextHostDisplayName =
        partyData.hostId === uid
          ? (nextMembers[0]?.displayName ?? null)
          : ((partyData.hostDisplayName as string | undefined) ?? null);
      const nextPlayerIds = nextMembers.map((member) => member.id);
      const nextPlayerNames = nextMembers.map((member) => member.displayName);

      transaction.update(partyRef, {
        hostId: nextHostId,
        hostDisplayName: nextHostDisplayName,
        memberIds: nextPlayerIds,
        playerIds: nextPlayerIds,
        playerNames: nextPlayerNames,
        playerCount: nextPlayerIds.length,
        players: nextPlayerIds.length,
        updatedAt: serverTimestamp(),
      });
    });

    await setActivePartyId(null);
  }, [partyId, setActivePartyId, uid]);

  const setGameType = useCallback(
    async (gameType: GameType) => {
      if (!uid || !partyId || !party || uid !== party.hostId) {
        throw new Error("Only the host can change game type.");
      }

      await updateDoc(doc(db, "parties", partyId), {
        spikeMode: gameType === "spike",
        updatedAt: serverTimestamp(),
      });
    },
    [party, partyId, uid],
  );

  const startGame = useCallback(async () => {
    if (!uid || !partyId || !party) {
      throw new Error("Missing active party.");
    }
    if (uid !== party.hostId) {
      throw new Error("Only the host can start the game.");
    }

    const partyRef = doc(db, "parties", partyId);
    const gameRef = doc(collection(db, "games"));

    await runTransaction(db, async (transaction) => {
      const partySnap = await transaction.get(partyRef);
      if (!partySnap.exists()) {
        throw new Error("Party not found.");
      }

      const partyData = partySnap.data();
      const playerSnapshot = await getDocs(
        query(collection(db, "parties", partyId, "partyMembers"), orderBy("joinedAt", "asc")),
      );
      if (playerSnapshot.empty) {
        throw new Error("Add at least one player before starting.");
      }

      const playerOrder = playerSnapshot.docs.map((playerDoc) => playerDoc.id);
      const spikeMode = Boolean(partyData.spikeMode);
      const spikeItemCount = (partyData.spikeItemCount as SpikeItemCount | undefined) ?? "low";
      const spikeRowClear = Boolean(partyData.spikeRowClear);
      const spikeEndGameBonuses = (partyData.spikeEndGameBonuses as boolean | undefined) ?? true;

      let shuffledDeck: Card[] = shuffleDeck(createMistyDeck());
      const playerGrids = new Map<string, number[]>();
      playerOrder.forEach((playerId) => {
        const grid: number[] = [];
        for (let i = 0; i < 12; i += 1) {
          const card = shuffledDeck.pop();
          if (typeof card !== "number") {
            throw new Error("Not enough cards to deal opening hands.");
          }
          grid.push(card);
        }
        playerGrids.set(playerId, grid);
      });

      if (spikeMode) {
        shuffledDeck = shuffleDeckWithDelayedSwapCards(shuffledDeck, spikeItemCount, playerOrder.length);
      }

      const discardCard = shuffledDeck.pop();
      if (discardCard === undefined) {
        throw new Error("Deck is empty after dealing.");
      }

      const startingPlayerId = playerOrder[Math.floor(Math.random() * playerOrder.length)] ?? playerOrder[0];

      transaction.set(gameRef, {
        status: "playing",
        partyId,
        hostId: uid,
        roundNumber: 1,
        currentPlayerId: startingPlayerId,
        activePlayerOrder: playerOrder,
        turnPhase: "choose-draw",
        deck: shuffledDeck,
        discard: [discardCard],
        graveyard: [],
        spikeMode,
        ...(spikeMode ? { spikeItemCount, spikeRowClear, spikeEndGameBonuses } : {}),
        lastTurnPlayerId: null,
        lastTurnAction: null,
        lastTurnActionAt: null,
        createdAt: serverTimestamp(),
      });

      playerSnapshot.docs.forEach((playerDoc, index) => {
        const initialRevealed = Array.from({ length: 12 }, () => false);
        const displayName = (playerDoc.data().displayName as string | undefined) ?? "Anonymous player";

        transaction.set(doc(db, "games", gameRef.id, "players", playerDoc.id), {
          displayName,
          seatIndex: index,
          isReady: false,
          roundScore: 0,
          totalScore: 0,
          pointsClearedFromRows: 0,
          pointsDiscarded: 0,
          discardedCardCount: 0,
          revealedCardValueTotal: 0,
          revealedCardCount: 0,
          itemCardsDrawn: 0,
          revealed: initialRevealed,
          publicGrid: Array.from({ length: 12 }, () => null),
          revealedCount: 0,
        });

        transaction.set(doc(db, "games", gameRef.id, "playerStates", playerDoc.id), {
          grid: playerGrids.get(playerDoc.id) ?? [],
          revealed: initialRevealed,
          pendingDraw: null,
          pendingDrawSource: null,
          totalScore: 0,
          pointsClearedFromRows: 0,
          pointsDiscarded: 0,
          discardedCardCount: 0,
          revealedCardValueTotal: 0,
          revealedCardCount: 0,
          itemCardsDrawn: 0,
        });
      });

      transaction.update(partyRef, {
        status: "in-game",
        activeGameId: gameRef.id,
        gameId: gameRef.id,
        updatedAt: serverTimestamp(),
      });
    });
  }, [party, partyId, uid]);

  const value = useMemo<PartyContextValue>(
    () => ({
      partyId,
      party,
      members,
      isHost: Boolean(uid && party?.hostId && uid === party.hostId),
      loading: loadingUser || loadingParty,
      invite,
      leave,
      setGameType,
      startGame,
      setActivePartyId,
    }),
    [invite, leave, loadingParty, loadingUser, members, party, partyId, setActivePartyId, setGameType, startGame, uid],
  );

  return <PartyContext.Provider value={value}>{children}</PartyContext.Provider>;
}

export function useParty() {
  const context = useContext(PartyContext);
  if (!context) {
    throw new Error("useParty must be used within LobbyProvider.");
  }

  return context;
}
