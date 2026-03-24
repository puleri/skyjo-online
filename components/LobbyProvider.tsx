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
} from "firebase/firestore";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured } from "../lib/firebase";
import { useRouter } from "next/navigation";
import {
  MIN_PARTY_SIZE_TO_START,
  isValidPreGameConfig,
  startPartyGameAction,
  type GameType,
  type PreGameConfig,
} from "../lib/partyActions";

type Party = {
  id: string;
  hostId: string | null;
  hostDisplayName: string | null;
  status: string;
  activeGameId: string | null;
  preGameConfig: PreGameConfig | null;
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
  setPreGameConfig: (config: PreGameConfig) => Promise<void>;
  startGame: () => Promise<void>;
  setActivePartyId: (nextPartyId: string | null) => Promise<void>;
};

const PartyContext = createContext<PartyContextValue | null>(null);

export { MIN_PARTY_SIZE_TO_START, isValidPreGameConfig };
export type { GameType, PreGameConfig };

function coerceSpikeItemCount(value: unknown): PreGameConfig["spikeItemCount"] {
  return value === "none" || value === "low" || value === "medium" || value === "high"
    ? value
    : "low";
}

function toPreGameConfig(data: Record<string, unknown>): PreGameConfig | null {
  const raw =
    data.preGameConfig && typeof data.preGameConfig === "object"
      ? (data.preGameConfig as Record<string, unknown>)
      : null;

  if (!raw) {
    if (typeof data.spikeMode !== "boolean") {
      return null;
    }
    const spikeMode = Boolean(data.spikeMode);
    return {
      gameType: spikeMode ? "spike" : "classic",
      spikeMode,
      spikeItemCount: coerceSpikeItemCount(data.spikeItemCount),
      spikeRowClear: Boolean(data.spikeRowClear),
      spikeEndGameBonuses: (data.spikeEndGameBonuses as boolean | undefined) ?? true,
    };
  }

  const gameType = raw.gameType === "classic" || raw.gameType === "spike" ? raw.gameType : null;
  const spikeMode = typeof raw.spikeMode === "boolean" ? raw.spikeMode : gameType === "spike";

  if (!gameType) {
    return null;
  }

  return {
    gameType,
    spikeMode,
    spikeItemCount: coerceSpikeItemCount(raw.spikeItemCount),
    spikeRowClear: Boolean(raw.spikeRowClear),
    spikeEndGameBonuses: (raw.spikeEndGameBonuses as boolean | undefined) ?? true,
  };
}

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
    preGameConfig: toPreGameConfig(data),
  };
}

export default function LobbyProvider({ children }: { children: ReactNode }) {
  const { uid } = useAnonymousAuth();
  const [partyId, setPartyId] = useState<string | null>(null);
  const [party, setParty] = useState<Party | null>(null);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [loadingUser, setLoadingUser] = useState(true);
  const [loadingParty, setLoadingParty] = useState(false);
  const router = useRouter();

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

  const setPreGameConfig = useCallback(
    async (config: PreGameConfig) => {
      if (!uid || !partyId) {
        throw new Error("Missing active party.");
      }
      if (!isValidPreGameConfig(config)) {
        throw new Error("Invalid pre-game config.");
      }

      const partyRef = doc(db, "parties", partyId);
      await runTransaction(db, async (transaction) => {
        const partySnap = await transaction.get(partyRef);
        if (!partySnap.exists()) {
          throw new Error("Party not found.");
        }

        const partyData = partySnap.data();
        if ((partyData.hostId as string | undefined) !== uid) {
          throw new Error("Only the host can update game settings.");
        }

        transaction.update(partyRef, {
          preGameConfig: config,
          updatedAt: serverTimestamp(),
        });
      });
    },
    [partyId, uid],
  );

  const startGame = useCallback(async () => {
    if (!uid || !partyId || !party) {
      throw new Error("Missing active party.");
    }
    if (uid !== party.hostId) {
      throw new Error("Only the host can start the game.");
    }

    await startPartyGameAction({
      db,
      partyId,
      callerUid: uid,
    });
  }, [party, partyId, uid]);


  useEffect(() => {
    if (!party?.activeGameId) {
      return;
    }

    router.push(`/game/${party.activeGameId}`);
  }, [party?.activeGameId, router]);

  const value = useMemo<PartyContextValue>(
    () => ({
      partyId,
      party,
      members,
      isHost: Boolean(uid && party?.hostId && uid === party.hostId),
      loading: loadingUser || loadingParty,
      invite,
      leave,
      setPreGameConfig,
      startGame,
      setActivePartyId,
    }),
    [invite, leave, loadingParty, loadingUser, members, party, partyId, setActivePartyId, setPreGameConfig, startGame, uid],
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
