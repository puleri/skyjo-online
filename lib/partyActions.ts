import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import {
  createMistyDeck,
  shuffleDeck,
  shuffleDeckWithDelayedSwapCards,
  type Card,
} from "./game/deck";
import type { SpikeItemCount } from "./game/deck";

export type GameType = "classic" | "spike";

export type PreGameConfig = {
  gameType: GameType;
  spikeMode: boolean;
  spikeItemCount: SpikeItemCount;
  spikeRowClear: boolean;
  spikeEndGameBonuses: boolean;
};

export const MIN_PARTY_SIZE_TO_START = 2;

export function isValidPreGameConfig(config: PreGameConfig | null | undefined) {
  if (!config) {
    return false;
  }
  if (config.gameType !== "classic" && config.gameType !== "spike") {
    return false;
  }
  if (config.spikeMode !== (config.gameType === "spike")) {
    return false;
  }
  if (!["none", "low", "medium", "high"].includes(config.spikeItemCount)) {
    return false;
  }
  return typeof config.spikeRowClear === "boolean" && typeof config.spikeEndGameBonuses === "boolean";
}

type StartPartyGameParams = {
  db: Firestore;
  partyId: string;
  callerUid: string;
};

type PartyMemberSnapshot = {
  id: string;
  displayName: string;
  photoURL: string | null;
  isHost: boolean;
  joinedAt: unknown;
};

function toPartyMemberSnapshot(id: string, data: Record<string, unknown>): PartyMemberSnapshot {
  return {
    id,
    displayName: (data.displayName as string | undefined) ?? "Anonymous player",
    photoURL: (data.photoURL as string | undefined) ?? null,
    isHost: Boolean(data.isHost),
    joinedAt: data.joinedAt,
  };
}

export async function startPartyGameAction({ db, partyId, callerUid }: StartPartyGameParams): Promise<string> {
  const partyRef = doc(db, "parties", partyId);
  const gameRef = doc(collection(db, "games"));
  const membersQuery = query(collection(db, "parties", partyId, "partyMembers"), orderBy("joinedAt", "asc"));

  await runTransaction(db, async (transaction) => {
    const partySnap = await transaction.get(partyRef);
    if (!partySnap.exists()) {
      throw new Error("Party not found.");
    }

    const partyData = partySnap.data() as Record<string, unknown>;
    if (partyData.hostId !== callerUid) {
      throw new Error("Only the host can start the game.");
    }

    const partyStatus = typeof partyData.status === "string" ? partyData.status : "open";
    if (partyStatus === "starting" || partyStatus === "in-game") {
      throw new Error("A game is already starting or in progress.");
    }

    const rawPreGameConfig =
      partyData.preGameConfig && typeof partyData.preGameConfig === "object"
        ? (partyData.preGameConfig as PreGameConfig)
        : null;
    if (!isValidPreGameConfig(rawPreGameConfig)) {
      throw new Error("Host must configure game settings before starting.");
    }
    const preGameConfig = rawPreGameConfig as PreGameConfig;

    const memberSnapshot = await getDocs(membersQuery);
    if (memberSnapshot.size < MIN_PARTY_SIZE_TO_START) {
      throw new Error(`Add at least ${MIN_PARTY_SIZE_TO_START} players before starting.`);
    }

    const partyMembers = memberSnapshot.docs.map((memberDoc) =>
      toPartyMemberSnapshot(memberDoc.id, memberDoc.data() as Record<string, unknown>),
    );
    const playerOrder = partyMembers.map((member) => member.id);

    const { spikeMode, spikeItemCount, spikeRowClear, spikeEndGameBonuses } = preGameConfig;

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
      hostId: callerUid,
      roundNumber: 1,
      currentPlayerId: startingPlayerId,
      activePlayerOrder: playerOrder,
      turnPhase: "choose-draw",
      deck: shuffledDeck,
      discard: [discardCard],
      graveyard: [],
      preGameConfig,
      partyMembersSnapshot: partyMembers,
      spikeMode,
      ...(spikeMode ? { spikeItemCount, spikeRowClear, spikeEndGameBonuses } : {}),
      lastTurnPlayerId: null,
      lastTurnAction: null,
      lastTurnActionAt: null,
      createdAt: serverTimestamp(),
    });

    memberSnapshot.docs.forEach((playerDoc, index) => {
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

  return gameRef.id;
}
