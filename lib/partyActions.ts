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
import { GLYPHS } from "./constants";
import {
  createMistyDeck,
  shuffleDeck,
  shuffleDeckWithDelayedSwapCards,
  type Card,
} from "./game/deck";
import type { SpikeItemCount } from "./game/deck";
import { buildStoredUserGame } from "./userGames";

export type GameType = "classic" | "spike";

export type PreGameConfig = {
  gameType: GameType;
  spikeMode: boolean;
  spikeItemCount: SpikeItemCount;
  spikeRowClear: boolean;
  spikeEndGameBonuses: boolean;
  targetScore: 50 | 100;
};

export const MIN_PARTY_SIZE_TO_START = 1;

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
  const isTargetScoreValid = config.targetScore === 50 || config.targetScore === 100;
  return (
    typeof config.spikeRowClear === "boolean" &&
    typeof config.spikeEndGameBonuses === "boolean" &&
    isTargetScoreValid
  );
}

type StartPartyGameParams = {
  db: Firestore;
  partyId: string;
  callerUid: string;
};
type StartSoloGameParams = {
  db: Firestore;
  callerUid: string;
  playerDisplayName: string;
  preGameConfig: PreGameConfig;
};

type JoinPartyInGameBehavior = "reject" | "spectate";

type JoinPartyByIdParams = {
  db: Firestore;
  partyId: string;
  uid: string;
  playerDisplayName: string;
  inGameBehavior?: JoinPartyInGameBehavior;
};

type JoinPartyByIdResult = {
  joinedAsMember: boolean;
  activeGameId: string | null;
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

function filterStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export async function joinPartyByIdAction({
  db,
  partyId,
  uid,
  playerDisplayName,
  inGameBehavior = "reject",
}: JoinPartyByIdParams): Promise<JoinPartyByIdResult> {
  const resolvedDisplayName = playerDisplayName.trim() || "Anonymous player";

  return runTransaction(db, async (transaction) => {
    const partyRef = doc(db, "parties", partyId);
    const partyMemberRef = doc(db, "parties", partyId, "partyMembers", uid);
    const userRef = doc(db, "users", uid);

    const [partySnap, existingMemberSnap] = await Promise.all([
      transaction.get(partyRef),
      transaction.get(partyMemberRef),
    ]);

    if (!partySnap.exists()) {
      throw new Error("Party not found.");
    }

    const partyData = partySnap.data();
    const partyStatus = typeof partyData.status === "string" ? partyData.status : "open";
    const activeGameId =
      typeof partyData.activeGameId === "string"
        ? partyData.activeGameId
        : typeof partyData.gameId === "string"
          ? partyData.gameId
          : null;
    const isInGame = partyStatus === "in-game";

    if (isInGame && inGameBehavior !== "spectate") {
      throw new Error(activeGameId ? "This lobby is already in a game. Spectate instead." : "This lobby is already in a game.");
    }

    if (isInGame && inGameBehavior === "spectate") {
      transaction.set(
        userRef,
        {
          activePartyId: partyId,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      return { joinedAsMember: false, activeGameId };
    }

    const existingPlayerIds = filterStringArray(partyData.playerIds);
    const existingPlayerNames = filterStringArray(partyData.playerNames);
    const availableGlyphs = (() => {
      const fromDoc = filterStringArray(partyData.availableGlyphs);
      return fromDoc.length ? fromDoc : [...GLYPHS];
    })();
    const assignedGlyphs = filterStringArray(partyData.assignedGlyphs);

    const isExistingMember = existingMemberSnap.exists() || existingPlayerIds.includes(uid);
    const nextGlyph = availableGlyphs[0] ?? null;
    const nextPlayerIds = isExistingMember ? existingPlayerIds : [...existingPlayerIds, uid];
    const nextPlayerNames = isExistingMember ? existingPlayerNames : [...existingPlayerNames, resolvedDisplayName];

    if (existingMemberSnap.exists()) {
      transaction.update(partyMemberRef, {
        displayName: resolvedDisplayName,
        photoURL: null,
        updatedAt: serverTimestamp(),
      });
    } else {
      const isHost = (partyData.hostId as string | undefined) === uid;
      transaction.set(partyMemberRef, {
        displayName: resolvedDisplayName,
        photoURL: null,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isHost,
      });
    }

    transaction.update(partyRef, {
      memberIds: nextPlayerIds,
      playerIds: nextPlayerIds,
      playerNames: nextPlayerNames,
      playerCount: nextPlayerIds.length,
      players: nextPlayerIds.length,
      assignedGlyphs: isExistingMember || !nextGlyph ? assignedGlyphs : [...assignedGlyphs, nextGlyph],
      availableGlyphs:
        isExistingMember || !nextGlyph
          ? availableGlyphs
          : availableGlyphs.filter((glyph) => glyph !== nextGlyph),
      updatedAt: serverTimestamp(),
    });

    transaction.set(
      userRef,
      {
        activePartyId: partyId,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return { joinedAsMember: true, activeGameId };
  });
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

    const { spikeMode, spikeItemCount, spikeRowClear, spikeEndGameBonuses, targetScore } = preGameConfig;

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
      targetScore,
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

    const playerIds = partyMembers.map((member) => member.id);
    const playerNames = partyMembers.map((member) => member.displayName);
    partyMembers.forEach((member) => {
      transaction.set(
        doc(db, "users", member.id, "savedGames", gameRef.id),
        buildStoredUserGame({
          gameId: gameRef.id,
          partyId,
          playerIds,
          playerNames,
        }),
      );
      transaction.set(
        doc(db, "users", member.id),
        {
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
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

export async function startSoloGameAction({
  db,
  callerUid,
  playerDisplayName,
  preGameConfig,
}: StartSoloGameParams): Promise<string> {
  if (!isValidPreGameConfig(preGameConfig)) {
    throw new Error("Invalid game settings.");
  }

  const gameRef = doc(collection(db, "games"));
  const playerOrder = [callerUid];
  const partyMembers: PartyMemberSnapshot[] = [
    {
      id: callerUid,
      displayName: playerDisplayName.trim() || "Anonymous player",
      photoURL: null,
      isHost: true,
      joinedAt: null,
    },
  ];
  const { spikeMode, spikeItemCount, spikeRowClear, spikeEndGameBonuses, targetScore } =
    preGameConfig;

  await runTransaction(db, async (transaction) => {
    let shuffledDeck: Card[] = shuffleDeck(createMistyDeck());
    const grid: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const card = shuffledDeck.pop();
      if (typeof card !== "number") {
        throw new Error("Not enough cards to deal opening hand.");
      }
      grid.push(card);
    }

    if (spikeMode) {
      shuffledDeck = shuffleDeckWithDelayedSwapCards(shuffledDeck, spikeItemCount, playerOrder.length);
    }

    const discardCard = shuffledDeck.pop();
    if (discardCard === undefined) {
      throw new Error("Deck is empty after dealing.");
    }

    transaction.set(gameRef, {
      status: "playing",
      partyId: null,
      hostId: callerUid,
      roundNumber: 1,
      currentPlayerId: callerUid,
      activePlayerOrder: playerOrder,
      turnPhase: "choose-draw",
      deck: shuffledDeck,
      discard: [discardCard],
      graveyard: [],
      preGameConfig,
      targetScore,
      partyMembersSnapshot: partyMembers,
      spikeMode,
      ...(spikeMode ? { spikeItemCount, spikeRowClear, spikeEndGameBonuses } : {}),
      lastTurnPlayerId: null,
      lastTurnAction: null,
      lastTurnActionAt: null,
      createdAt: serverTimestamp(),
    });

    const initialRevealed = Array.from({ length: 12 }, () => false);
    transaction.set(doc(db, "games", gameRef.id, "players", callerUid), {
      displayName: partyMembers[0].displayName,
      seatIndex: 0,
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

    transaction.set(doc(db, "games", gameRef.id, "playerStates", callerUid), {
      grid,
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

    transaction.set(
      doc(db, "users", callerUid, "savedGames", gameRef.id),
      buildStoredUserGame({
        gameId: gameRef.id,
        partyId: null,
        playerIds: [callerUid],
        playerNames: [partyMembers[0].displayName],
      }),
    );
    transaction.set(
      doc(db, "users", callerUid),
      {
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });

  return gameRef.id;
}
