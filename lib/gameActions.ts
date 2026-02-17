import { deleteField, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import {
  Card,
  ItemCard,
  ItemCode,
  SpikeItemCount,
  createItemCards,
  createSkyjoDeck,
  shuffleDeck,
} from "./game/deck";

export type TurnPhase =
  | "choose-draw"
  | "resolve-draw"
  | "choose-swap"
  | "resolve"
  | "resolve-item";

type GameDoc = {
  activePlayerOrder: string[];
  currentPlayerId: string;
  deck: Card[];
  discard: Card[];
  graveyard?: Card[];
  hostId?: string | null;
  roundNumber?: number;
  turnPhase: TurnPhase;
  spikeMode?: boolean;
  spikeItemCount?: SpikeItemCount;
  spikeRowClear?: boolean;
  spikeEndGameBonuses?: boolean;
  endingPlayerId?: string | null;
  finalTurnRemainingIds?: string[] | null;
  selectedDiscardPlayerId?: string | null;
  status?: string;
  roundScores?: Record<string, number>;
  lastTurnPlayerId?: string | null;
  lastTurnAction?: string | null;
  lastTurnActionAt?: unknown;
  lastClearType?: "row" | "column" | "row-column" | null;
  lastClearTypeAt?: unknown;
  skipNextTurnPlayerIds?: string[] | null;
  readyPlayerIds?: string[] | null;
  endGameBonusResults?: {
    mostRowsClearedWinnerId?: string | null;
    lowestDiscardedWinnerId?: string | null;
  } | null;
};

type PlayerStateDoc = {
  grid: Array<Card | null>;
  revealed: boolean[];
  pendingDraw?: Card | null;
  pendingDrawSource?: "deck" | "discard" | null;
  totalScore?: number;
  mistTurnsRemaining?: number | null;
  sprintTurnsRemaining?: number | null;
  pointsClearedFromRows?: number;
  pointsDiscarded?: number;
};

type PlayerSummaryDoc = {
  displayName?: string;
  isReady?: boolean;
  roundScore?: number;
  totalScore?: number;
  revealedCount?: number;
  revealed?: boolean[];
  publicGrid?: Array<Card | null>;
  pendingDraw?: Card | null;
  pendingDrawSource?: "deck" | "discard" | null;
  mistTurnsRemaining?: number | null;
  sprintTurnsRemaining?: number | null;
  pointsClearedFromRows?: number;
  pointsDiscarded?: number;
};

const columns = 4;
const getPlayerStateRef = (gameId: string, playerId: string) =>
  doc(db, "games", gameId, "playerStates", playerId);
const getPlayerSummaryRef = (gameId: string, playerId: string) =>
  doc(db, "games", gameId, "players", playerId);
const getRevealedCount = (revealed: boolean[]) =>
  revealed.reduce((total, value) => total + (value ? 1 : 0), 0);
const getPublicGrid = (grid: Array<Card | null>, revealed: boolean[]) =>
  grid.map((card, index) => (revealed[index] ? card : null));
const getPublicSummary = (player: Pick<PlayerStateDoc, "grid" | "revealed">) => ({
  revealed: player.revealed,
  publicGrid: getPublicGrid(player.grid, player.revealed),
  revealedCount: getRevealedCount(player.revealed),
});
const getMaskedSummary = (gridLength: number) => ({
  revealed: Array.from({ length: gridLength }, () => false),
  publicGrid: Array.from({ length: gridLength }, () => null),
  revealedCount: 0,
});
const getPublicSummaryUpdates = (
  previousMist: PlayerStateDoc["mistTurnsRemaining"],
  player: Pick<PlayerStateDoc, "grid" | "revealed" | "mistTurnsRemaining">
) => {
  const wasMisted = (previousMist ?? 0) > 0;
  const isMisted = (player.mistTurnsRemaining ?? 0) > 0;

  if (isMisted) {
    if (!wasMisted) {
      return getMaskedSummary(player.grid.length);
    }
    return null;
  }

  return getPublicSummary(player);
};

const getPendingSummaryUpdates = (
  pendingDraw: PlayerStateDoc["pendingDraw"],
  pendingDrawSource: PlayerStateDoc["pendingDrawSource"]
) => ({
  pendingDraw: pendingDraw ?? null,
  pendingDrawSource: pendingDrawSource ?? null,
});

const getMistSummaryUpdates = (mistTurnsRemaining: PlayerStateDoc["mistTurnsRemaining"]) => ({
  mistTurnsRemaining: mistTurnsRemaining ?? null,
});

const getSprintSummaryUpdates = (
  sprintTurnsRemaining: PlayerStateDoc["sprintTurnsRemaining"]
) => ({
  sprintTurnsRemaining: sprintTurnsRemaining ?? null,
});

const decrementMistAfterTurn = (player: PlayerStateDoc) => {
  const currentMist = player.mistTurnsRemaining ?? 0;
  if (currentMist <= 0) {
    return player;
  }
  const nextMist = currentMist - 1;
  return {
    ...player,
    mistTurnsRemaining: nextMist > 0 ? nextMist : null,
  };
};

const decrementSprintAfterTurn = (player: PlayerStateDoc) => {
  const currentSprint = player.sprintTurnsRemaining ?? 0;
  if (currentSprint <= 0) {
    return player;
  }
  const nextSprint = currentSprint - 1;
  return {
    ...player,
    sprintTurnsRemaining: nextSprint > 0 ? nextSprint : null,
  };
};

const assertCondition = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const getNextPlayerId = (order: string[], currentPlayerId: string) => {
  const currentIndex = order.indexOf(currentPlayerId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % order.length;
  return order[nextIndex];
};

const getColumnIndices = (index: number) => {
  const column = index % columns;
  return [column, column + columns, column + columns * 2];
};

const getRowIndices = (index: number) => {
  const row = Math.floor(index / columns);
  return Array.from({ length: columns }, (_, offset) => row * columns + offset);
};

const isLineMatch = (grid: Array<Card | null>, revealed: boolean[], indices: number[]) => {
  const values = indices.map((lineIndex) => grid[lineIndex]);
  const hasNull = values.some((value) => value === null || value === undefined);
  if (hasNull) {
    return false;
  }
  const allRevealed = indices.every((lineIndex) => revealed[lineIndex]);
  if (!allRevealed) {
    return false;
  }
  const [first, ...rest] = values;
  return rest.every((value) => value === first);
};

const clearMatchesAtIndex = (
  grid: Array<Card | null>,
  revealed: boolean[],
  index: number,
  rowClear: boolean
) => {
  const matchedIndices = new Set<number>();
  const matchedRowIndices = new Set<number>();
  let clearedColumn = false;
  let clearedRow = false;
  const columnIndices = getColumnIndices(index);
  if (isLineMatch(grid, revealed, columnIndices)) {
    columnIndices.forEach((columnIndex) => matchedIndices.add(columnIndex));
    clearedColumn = true;
  }
  if (rowClear) {
    const rowIndices = getRowIndices(index);
    if (isLineMatch(grid, revealed, rowIndices)) {
      rowIndices.forEach((rowIndex) => matchedIndices.add(rowIndex));
      rowIndices.forEach((rowIndex) => matchedRowIndices.add(rowIndex));
      clearedRow = true;
    }
  }
  if (matchedIndices.size === 0) {
    return {
      grid,
      revealed,
      clearedCards: [] as Card[],
      clearedRow,
      clearedColumn,
      rowClearedPoints: 0,
    };
  }
  const nextGrid = [...grid];
  const nextRevealed = [...revealed];
  const clearedCards: Card[] = [];
  matchedIndices.forEach((matchedIndex) => {
    const value = grid[matchedIndex];
    if (value !== null && value !== undefined) {
      clearedCards.push(value);
    }
    nextGrid[matchedIndex] = null;
    nextRevealed[matchedIndex] = true;
  });
  const rowClearedPoints = Array.from(matchedRowIndices).reduce(
    (total, matchedIndex) => total + getNumberCardPoints(grid[matchedIndex]),
    0
  );
  return {
    grid: nextGrid,
    revealed: nextRevealed,
    clearedCards,
    clearedRow,
    clearedColumn,
    rowClearedPoints,
  };
};

const clearMatchedLines = (grid: Array<Card | null>, revealed: boolean[], rowClear: boolean) => {
  const nextGrid = [...grid];
  const nextRevealed = [...revealed];
  const matchedIndices = new Set<number>();
  const clearedCards: Card[] = [];
  let clearedColumn = false;
  let clearedRow = false;
  for (let column = 0; column < columns; column += 1) {
    const columnIndices = getColumnIndices(column);
    if (isLineMatch(grid, revealed, columnIndices)) {
      columnIndices.forEach((columnIndex) => matchedIndices.add(columnIndex));
      clearedColumn = true;
    }
  }
  if (rowClear) {
    const rowCount = Math.floor(grid.length / columns);
    for (let row = 0; row < rowCount; row += 1) {
      const rowIndices = Array.from({ length: columns }, (_, offset) => row * columns + offset);
      if (isLineMatch(grid, revealed, rowIndices)) {
        rowIndices.forEach((rowIndex) => matchedIndices.add(rowIndex));
        clearedRow = true;
      }
    }
  }
  matchedIndices.forEach((matchedIndex) => {
    const value = grid[matchedIndex];
    if (value !== null && value !== undefined) {
      clearedCards.push(value);
    }
    nextGrid[matchedIndex] = null;
    nextRevealed[matchedIndex] = true;
  });
  return { grid: nextGrid, revealed: nextRevealed, clearedCards, clearedRow, clearedColumn };
};

const allCardsRevealed = (revealed: boolean[]) => revealed.every(Boolean);

const calculateScore = (grid: Array<Card | null>) =>
  grid.reduce<number>((total, value) => total + (typeof value === "number" ? value : 0), 0);

const getNumberCardPoints = (card: Card | null | undefined) =>
  typeof card === "number" ? card : 0;

const isItemCard = (card: Card | null | undefined): card is ItemCard =>
  card != null && typeof card === "object" && "kind" in card && card.kind === "item";

const assertNumberCard: (card: Card | null, message: string) => asserts card is number = (
  card,
  message
) => {
  assertCondition(typeof card === "number", message);
};

const assertItemCard: (
  card: Card | null | undefined,
  message: string
) => asserts card is ItemCard = (card, message) => {
  if (!card || !isItemCard(card)) {
    throw new Error(message);
  }
};

const drawRandomNumberCard = (deck: Card[]) => {
  const numberIndices = deck
    .map((card, index) => (typeof card === "number" ? index : -1))
    .filter((index) => index >= 0);
  assertCondition(numberIndices.length > 0, "Deck has no number cards.");
  const randomIndex =
    numberIndices[Math.floor(Math.random() * numberIndices.length)] ?? numberIndices[0];
  const [drawn] = deck.splice(randomIndex, 1);
  assertCondition(typeof drawn === "number", "Failed to draw a number card.");
  return drawn;
};

const clearPlayerMatches = (player: PlayerStateDoc, rowClear: boolean) => {
  const cleared = clearMatchedLines([...player.grid], [...player.revealed], rowClear);
  const rowClearedPoints = cleared.clearedRow
    ? cleared.clearedCards.reduce<number>(
        (total, card) => total + getNumberCardPoints(card),
        0
      )
    : 0;
  return {
    player: {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
      pointsClearedFromRows: (player.pointsClearedFromRows ?? 0) + rowClearedPoints,
    },
    clearedCards: cleared.clearedCards,
    clearedRow: cleared.clearedRow,
    clearedColumn: cleared.clearedColumn,
  };
};

const validateGridIndex = (player: PlayerStateDoc, targetIndex: number) => {
  assertCondition(targetIndex >= 0 && targetIndex < player.grid.length, "Invalid index.");
};

const validateCardSlot = (player: PlayerStateDoc, targetIndex: number) => {
  validateGridIndex(player, targetIndex);
  assertCondition(
    player.grid[targetIndex] !== null && player.grid[targetIndex] !== undefined,
    "Slot is empty."
  );
};

const assertItemCodeMatch = (pendingCard: Card | null | undefined, code: ItemCode) => {
  if (!pendingCard || !isItemCard(pendingCard)) {
    throw new Error("Pending draw is not an item.");
  }
  assertCondition(pendingCard.code === code, "Item card mismatch.");
};

type ItemTarget = {
  playerId: string;
  index: number;
};

type ItemUsage =
  | { code: "A"; target: ItemTarget }
  | { code: "C"; target: ItemTarget; value: number }
  | { code: "E"; first: ItemTarget; second: ItemTarget }
  | { code: "F" }
  | { code: "G" };

const describeItemAction = (usage: ItemUsage) => {
  switch (usage.code) {
    case "A":
      return "used Randomize to reroll a card.";
    case "C":
      return `used Wild to set a card to ${usage.value}.`;
    case "E":
      return "used Swap to swap two cards.";
    case "F":
      return "used Mist to summon mist.";
    case "G":
      return "used Push to draw three.";
    default:
      return "used an item.";
  }
};

type TurnResolution = {
  gameUpdates: Partial<GameDoc>;
  roundComplete: boolean;
  endingPlayerId: string | null;
  finalTurnRemainingIds: string[] | null;
  updatedPlayer: PlayerStateDoc;
};

const getClearType = (clearedRow: boolean, clearedColumn: boolean) => {
  if (clearedRow && clearedColumn) {
    return "row-column" as const;
  }
  if (clearedRow) {
    return "row" as const;
  }
  if (clearedColumn) {
    return "column" as const;
  }
  return null;
};

const resolveTurn = (
  game: GameDoc,
  updatedPlayerId: string,
  updatedPlayer: PlayerStateDoc
): TurnResolution => {
  const activeOrder = game.activePlayerOrder;
  const mistAdjustedPlayer = decrementMistAfterTurn(updatedPlayer);
  const resolvedPlayer = decrementSprintAfterTurn(mistAdjustedPlayer);
  let endingPlayerId = game.endingPlayerId ?? null;
  let finalTurnRemainingIds = game.finalTurnRemainingIds ?? null;
  const skipNextTurnPlayerIds = new Set(game.skipNextTurnPlayerIds ?? []);

  if (!endingPlayerId && allCardsRevealed(updatedPlayer.revealed)) {
    endingPlayerId = updatedPlayerId;
    finalTurnRemainingIds = activeOrder.filter((playerId) => playerId !== updatedPlayerId);
  }

  if (endingPlayerId && finalTurnRemainingIds?.includes(updatedPlayerId)) {
    finalTurnRemainingIds = finalTurnRemainingIds.filter((playerId) => playerId !== updatedPlayerId);
  }

  const roundComplete = Boolean(endingPlayerId && finalTurnRemainingIds?.length === 0);

  if (roundComplete) {
    return {
      gameUpdates: {
        currentPlayerId: endingPlayerId ?? game.currentPlayerId,
        status: "round-complete",
        endingPlayerId,
        finalTurnRemainingIds: [],
        turnPhase: "choose-draw",
        skipNextTurnPlayerIds: [],
      },
      roundComplete,
      endingPlayerId,
      finalTurnRemainingIds: [],
      updatedPlayer: resolvedPlayer,
    };
  }

  let refreshedDeck: Card[] | null = null;
  if (game.deck.length === 0) {
    const discardPile = game.discard;
    const remainingDiscard = discardPile.slice(0, -1);
    if (remainingDiscard.length > 0) {
      refreshedDeck = shuffleDeck(remainingDiscard);
    }
  }

  if ((resolvedPlayer.sprintTurnsRemaining ?? 0) > 0) {
    return {
      gameUpdates: {
        currentPlayerId: updatedPlayerId,
        endingPlayerId,
        finalTurnRemainingIds,
        turnPhase: "choose-draw",
        skipNextTurnPlayerIds: Array.from(skipNextTurnPlayerIds),
        ...(refreshedDeck ? { deck: refreshedDeck } : {}),
      },
      roundComplete,
      endingPlayerId,
      finalTurnRemainingIds,
      updatedPlayer: resolvedPlayer,
    };
  }

  let nextPlayerId = getNextPlayerId(activeOrder, updatedPlayerId);
  let safetyCounter = 0;
  while (skipNextTurnPlayerIds.has(nextPlayerId) && safetyCounter < activeOrder.length) {
    skipNextTurnPlayerIds.delete(nextPlayerId);
    nextPlayerId = getNextPlayerId(activeOrder, nextPlayerId);
    safetyCounter += 1;
  }
  return {
    gameUpdates: {
      currentPlayerId: nextPlayerId,
      endingPlayerId,
      finalTurnRemainingIds,
      turnPhase: "choose-draw",
      skipNextTurnPlayerIds: Array.from(skipNextTurnPlayerIds),
      ...(refreshedDeck ? { deck: refreshedDeck } : {}),
    },
    roundComplete,
    endingPlayerId,
    finalTurnRemainingIds,
    updatedPlayer: resolvedPlayer,
  };
};

type PlayerSnapshot = PlayerStateDoc;

const computeRoundScores = (
  activeOrder: string[],
  players: Record<string, PlayerSnapshot>,
  endingPlayerId: string | null,
  rowClear: boolean,
  applyEndGameBonuses: boolean
) => {
  const roundScores: Record<string, number> = {};
  const scoresByPlayer = activeOrder.map((playerId) => {
    const player = players[playerId];
    const revealed = player.revealed.map(() => true);
    const cleared = clearMatchedLines(player.grid, revealed, rowClear);
    const score = calculateScore(cleared.grid);
    roundScores[playerId] = score;
    return { playerId, score, cleared };
  });
  const allScores = scoresByPlayer.map(({ score }) => score);
  const lowestScore =
    allScores.reduce<number | null>((lowest, score) => {
      if (lowest === null || score < lowest) {
        return score;
      }
      return lowest;
    }, null) ?? 0;
  const lowestScoreCount = allScores.filter((score) => score === lowestScore).length;
  if (endingPlayerId) {
    const endingScore = roundScores[endingPlayerId];
    const shouldDouble =
      endingScore > lowestScore || (endingScore === lowestScore && lowestScoreCount > 1);
    if (shouldDouble) {
      roundScores[endingPlayerId] = endingScore * 2;
    }
  }

  const stateUpdates: Record<string, Partial<PlayerStateDoc>> = {};
  const summaryUpdates: Record<string, Partial<PlayerSummaryDoc>> = {};
  const totalScores: number[] = [];
  const totalsByPlayer: Record<string, number> = {};
  activeOrder.forEach((playerId, index) => {
    const cleared = scoresByPlayer[index].cleared;
    const previousTotal = players[playerId].totalScore ?? 0;
    const totalScore = previousTotal + roundScores[playerId];
    totalScores.push(totalScore);
    totalsByPlayer[playerId] = totalScore;
    const clearedPlayer = {
      ...players[playerId],
      grid: cleared.grid,
      revealed: cleared.revealed,
    };
    const publicSummaryUpdates = getPublicSummaryUpdates(
      players[playerId].mistTurnsRemaining,
      clearedPlayer
    );
    stateUpdates[playerId] = {
      grid: cleared.grid,
      revealed: cleared.revealed,
      totalScore,
    };
    summaryUpdates[playerId] = {
      isReady: false,
      roundScore: roundScores[playerId],
      totalScore,
      ...(publicSummaryUpdates ?? {}),
      ...getPendingSummaryUpdates(null, null),
    };
  });

  const isGameComplete = totalScores.some((totalScore) => totalScore >= 100);

  let endGameBonusResults: GameDoc["endGameBonusResults"] = null;
  if (isGameComplete && applyEndGameBonuses) {
    const mostRowsClearedWinnerId =
      activeOrder.reduce<string | null>((winnerId, playerId) => {
        if (!winnerId) {
          return playerId;
        }
        const winnerValue = players[winnerId].pointsClearedFromRows ?? 0;
        const candidateValue = players[playerId].pointsClearedFromRows ?? 0;
        return candidateValue > winnerValue ? playerId : winnerId;
      }, null) ?? null;

    const lowestDiscardedWinnerId =
      activeOrder.reduce<string | null>((winnerId, playerId) => {
        if (!winnerId) {
          return playerId;
        }
        const winnerValue = players[winnerId].pointsDiscarded ?? 0;
        const candidateValue = players[playerId].pointsDiscarded ?? 0;
        return candidateValue < winnerValue ? playerId : winnerId;
      }, null) ?? null;

    const bonusCounts: Record<string, number> = {};
    if (mostRowsClearedWinnerId) {
      bonusCounts[mostRowsClearedWinnerId] = (bonusCounts[mostRowsClearedWinnerId] ?? 0) + 1;
    }
    if (lowestDiscardedWinnerId) {
      bonusCounts[lowestDiscardedWinnerId] = (bonusCounts[lowestDiscardedWinnerId] ?? 0) + 1;
    }

    Object.entries(bonusCounts).forEach(([bonusPlayerId, bonusCount]) => {
      const deduction = bonusCount * 5;
      totalsByPlayer[bonusPlayerId] = (totalsByPlayer[bonusPlayerId] ?? 0) - deduction;
      stateUpdates[bonusPlayerId] = {
        ...stateUpdates[bonusPlayerId],
        totalScore: totalsByPlayer[bonusPlayerId],
      };
      summaryUpdates[bonusPlayerId] = {
        ...summaryUpdates[bonusPlayerId],
        totalScore: totalsByPlayer[bonusPlayerId],
      };
    });

    endGameBonusResults = {
      mostRowsClearedWinnerId,
      lowestDiscardedWinnerId,
    };
  }

  return { roundScores, stateUpdates, summaryUpdates, isGameComplete, endGameBonusResults };
};

export const drawFromDiscard = async (
  gameId: string,
  playerId: string,
  targetIndex: number
) => {
  const gameRef = doc(db, "games", gameId);
  const playerStateRef = getPlayerStateRef(gameId, playerId);
  const playerSummaryRef = getPlayerSummaryRef(gameId, playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "choose-draw", "Not in draw phase.");
    assertCondition(game.discard.length > 0, "Discard pile is empty.");

    const playerSnap = await transaction.get(playerStateRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerStateDoc;
    assertCondition(player.pendingDraw == null, "You already have a pending draw.");
    assertCondition(
      (player.sprintTurnsRemaining ?? 0) <= 0,
      "Cannot draw from discard while sprinting."
    );
    validateGridIndex(player, targetIndex);

    const discard = [...game.discard];
    const drawnCard = discard.pop();
    assertCondition(drawnCard !== undefined, "Discard pile is empty.");
    const drawn = drawnCard as Card;

    if (isItemCard(drawn)) {
      const isMistItem = drawn.code === "F";
      const updatedPlayer = isMistItem
        ? {
            ...player,
            mistTurnsRemaining: 6,
          }
        : player;
      const publicSummaryUpdates = isMistItem
        ? getPublicSummaryUpdates(player.mistTurnsRemaining, updatedPlayer)
        : null;
      transaction.update(playerStateRef, {
        pendingDraw: drawn,
        pendingDrawSource: "discard",
        ...(isMistItem ? { mistTurnsRemaining: updatedPlayer.mistTurnsRemaining ?? null } : {}),
      });
      transaction.update(playerSummaryRef, {
        ...(publicSummaryUpdates ?? {}),
        ...getPendingSummaryUpdates(drawn, "discard"),
        ...(isMistItem ? getMistSummaryUpdates(updatedPlayer.mistTurnsRemaining) : {}),
      });
      transaction.update(gameRef, {
        discard,
        selectedDiscardPlayerId: null,
        turnPhase: "resolve-item",
      });
      return;
    }

    const grid = [...player.grid];
    const revealed = [...player.revealed];
    const replacedCard = grid[targetIndex];
    assertCondition(replacedCard !== null && replacedCard !== undefined, "Slot is empty.");

    grid[targetIndex] = drawn;
    revealed[targetIndex] = true;
    discard.push(replacedCard as Card);

    const rowClear = Boolean(game.spikeMode && game.spikeRowClear);
    const cleared = clearMatchesAtIndex(grid, revealed, targetIndex, rowClear);
    if (cleared.clearedCards.length > 0) {
      discard.push(...cleared.clearedCards);
    }

    const updatedPlayer: PlayerStateDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
      pointsClearedFromRows: (player.pointsClearedFromRows ?? 0) + cleared.rowClearedPoints,
      pointsDiscarded: (player.pointsDiscarded ?? 0) + getNumberCardPoints(replacedCard),
    };
    const lastClearType = getClearType(cleared.clearedRow, cleared.clearedColumn);

    const lastTurnAction = "took discard pile card and swapped card.";
    const resolution = resolveTurn(game, playerId, updatedPlayer);
    const resolvedPlayer = resolution.updatedPlayer;

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: {
      stateUpdates: Record<string, Partial<PlayerStateDoc>>;
      summaryUpdates: Record<string, Partial<PlayerSummaryDoc>>;
    } | null = null;
    let gameStatusOverride: string | null = null;
    let endGameBonusResults: GameDoc["endGameBonusResults"] = null;

    if (resolution.roundComplete) {
      const players: Record<string, PlayerSnapshot> = {};
      await Promise.all(
        game.activePlayerOrder.map(async (activePlayerId) => {
          if (activePlayerId === playerId) {
            players[activePlayerId] = {
              ...resolvedPlayer,
            };
            return;
          }
          const playerStateSnap = await transaction.get(
            getPlayerStateRef(gameId, activePlayerId)
          );
          assertCondition(playerStateSnap.exists(), "Player not found.");
          players[activePlayerId] = {
            ...(playerStateSnap.data() as PlayerStateDoc),
          };
        })
      );

      const scoring = computeRoundScores(
        game.activePlayerOrder,
        players,
        resolution.endingPlayerId,
        rowClear,
        Boolean(game.spikeMode && game.spikeEndGameBonuses !== false)
      );
      roundScores = scoring.roundScores;
      scoreUpdates = {
        stateUpdates: scoring.stateUpdates,
        summaryUpdates: scoring.summaryUpdates,
      };
      gameStatusOverride = scoring.isGameComplete ? "game-complete" : "round-complete";
      endGameBonusResults = scoring.endGameBonusResults;
    }

    transaction.update(playerStateRef, {
      grid: resolvedPlayer.grid,
      revealed: resolvedPlayer.revealed,
      pendingDraw: null,
      pendingDrawSource: null,
      mistTurnsRemaining: resolvedPlayer.mistTurnsRemaining ?? null,
      sprintTurnsRemaining: resolvedPlayer.sprintTurnsRemaining ?? null,
      pointsClearedFromRows: resolvedPlayer.pointsClearedFromRows ?? 0,
      pointsDiscarded: resolvedPlayer.pointsDiscarded ?? 0,
    });
    const publicSummaryUpdates = getPublicSummaryUpdates(
      player.mistTurnsRemaining,
      resolvedPlayer
    );
    transaction.update(playerSummaryRef, {
      ...(publicSummaryUpdates ?? {}),
      ...getPendingSummaryUpdates(null, null),
      ...getMistSummaryUpdates(resolvedPlayer.mistTurnsRemaining),
      ...getSprintSummaryUpdates(resolvedPlayer.sprintTurnsRemaining),
      pointsClearedFromRows: resolvedPlayer.pointsClearedFromRows ?? 0,
      pointsDiscarded: resolvedPlayer.pointsDiscarded ?? 0,
    });
    transaction.update(gameRef, {
      discard,
      selectedDiscardPlayerId: null,
      lastTurnPlayerId: playerId,
      lastTurnAction,
      lastTurnActionAt: serverTimestamp(),
      lastClearType,
      lastClearTypeAt: serverTimestamp(),
      ...resolution.gameUpdates,
      ...(gameStatusOverride ? { status: gameStatusOverride } : {}),
      ...(roundScores ? { roundScores } : {}),
      ...(endGameBonusResults ? { endGameBonusResults } : {}),
    });

    if (scoreUpdates) {
      Object.entries(scoreUpdates.stateUpdates).forEach(([targetPlayerId, updates]) => {
        transaction.update(getPlayerStateRef(gameId, targetPlayerId), updates);
      });
      Object.entries(scoreUpdates.summaryUpdates).forEach(([targetPlayerId, updates]) => {
        transaction.update(getPlayerSummaryRef(gameId, targetPlayerId), updates);
      });
    }
  });
};

export const drawFromDeck = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);
  const playerStateRef = getPlayerStateRef(gameId, playerId);
  const playerSummaryRef = getPlayerSummaryRef(gameId, playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "choose-draw", "Not in draw phase.");
    assertCondition(game.deck.length > 0, "Deck is empty.");

    const playerSnap = await transaction.get(playerStateRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerStateDoc;
    assertCondition(player.pendingDraw == null, "You already have a pending draw.");

    const deck = [...game.deck];
    const drawnCard = deck.pop();
    assertCondition(drawnCard !== undefined, "Deck is empty.");
    const drawn = drawnCard as Card;

    const isMistItem = isItemCard(drawn) && drawn.code === "F";
    const updatedPlayer = isMistItem
      ? {
          ...player,
          mistTurnsRemaining: 6,
        }
      : player;
    const publicSummaryUpdates = isMistItem
      ? getPublicSummaryUpdates(player.mistTurnsRemaining, updatedPlayer)
      : null;
    transaction.update(playerStateRef, {
      pendingDraw: drawn,
      pendingDrawSource: "deck",
      ...(isMistItem ? { mistTurnsRemaining: updatedPlayer.mistTurnsRemaining ?? null } : {}),
    });
    transaction.update(playerSummaryRef, {
      ...(publicSummaryUpdates ?? {}),
      ...getPendingSummaryUpdates(drawn, "deck"),
      ...(isMistItem ? getMistSummaryUpdates(updatedPlayer.mistTurnsRemaining) : {}),
    });
    transaction.update(gameRef, {
      deck,
      turnPhase: isItemCard(drawn) ? "resolve-item" : "resolve-draw",
      selectedDiscardPlayerId: null,
    });
  });
};

export const selectDiscard = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);
  const playerStateRef = getPlayerStateRef(gameId, playerId);
  const playerSummaryRef = getPlayerSummaryRef(gameId, playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "choose-draw", "Not in draw phase.");
    assertCondition(game.discard.length > 0, "Discard pile is empty.");

    const playerSnap = await transaction.get(playerStateRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerStateDoc;
    assertCondition(player.pendingDraw == null, "You already have a pending draw.");
    assertCondition(
      (player.sprintTurnsRemaining ?? 0) <= 0,
      "Cannot draw from discard while sprinting."
    );

    const topDiscard = game.discard[game.discard.length - 1];
    assertCondition(topDiscard !== undefined, "Discard pile is empty.");

    if (isItemCard(topDiscard)) {
      const discard = game.discard.slice(0, -1);

      const isMistItem = topDiscard.code === "F";
      const updatedPlayer = isMistItem
        ? {
            ...player,
            mistTurnsRemaining: 6,
          }
        : player;
      const publicSummaryUpdates = isMistItem
        ? getPublicSummaryUpdates(player.mistTurnsRemaining, updatedPlayer)
        : null;
      transaction.update(playerStateRef, {
        pendingDraw: topDiscard,
        pendingDrawSource: "discard",
        ...(isMistItem ? { mistTurnsRemaining: updatedPlayer.mistTurnsRemaining ?? null } : {}),
      });
      transaction.update(playerSummaryRef, {
        ...(publicSummaryUpdates ?? {}),
        ...getPendingSummaryUpdates(topDiscard, "discard"),
        ...(isMistItem ? getMistSummaryUpdates(updatedPlayer.mistTurnsRemaining) : {}),
      });
      transaction.update(gameRef, {
        discard,
        selectedDiscardPlayerId: null,
        turnPhase: "resolve-item",
      });
      return;
    }

    transaction.update(gameRef, { selectedDiscardPlayerId: playerId });
  });
};

export const chooseKeepFromDeck = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);
  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;
    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "resolve-draw", "Not in resolve draw phase.");
    transaction.update(gameRef, { turnPhase: "choose-swap" });
  });
};

export const swapPendingDraw = async (
  gameId: string,
  playerId: string,
  targetIndex: number
) => {
  const gameRef = doc(db, "games", gameId);
  const playerStateRef = getPlayerStateRef(gameId, playerId);
  const playerSummaryRef = getPlayerSummaryRef(gameId, playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(
      game.turnPhase === "resolve-draw" || game.turnPhase === "choose-swap",
      "Not in swap phase."
    );

    const playerSnap = await transaction.get(playerStateRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerStateDoc;
    assertCondition(player.pendingDraw != null, "No pending draw to keep.");
    assertCondition(!isItemCard(player.pendingDraw), "Pending draw is an item.");
    validateGridIndex(player, targetIndex);

    const grid = [...player.grid];
    const revealed = [...player.revealed];
    const replacedCard = grid[targetIndex];
    assertCondition(replacedCard !== null && replacedCard !== undefined, "Slot is empty.");

    grid[targetIndex] = player.pendingDraw as Card;
    revealed[targetIndex] = true;

    const discard = [...game.discard, replacedCard as Card];
    const rowClear = Boolean(game.spikeMode && game.spikeRowClear);
    const cleared = clearMatchesAtIndex(grid, revealed, targetIndex, rowClear);
    if (cleared.clearedCards.length > 0) {
      discard.push(...cleared.clearedCards);
    }

    const updatedPlayer: PlayerStateDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
      pointsClearedFromRows: (player.pointsClearedFromRows ?? 0) + cleared.rowClearedPoints,
      pointsDiscarded: (player.pointsDiscarded ?? 0) + getNumberCardPoints(replacedCard),
    };
    const lastClearType = getClearType(cleared.clearedRow, cleared.clearedColumn);

    const lastTurnAction = "drew from deck and swapped card.";
    const resolution = resolveTurn(game, playerId, updatedPlayer);
    const resolvedPlayer = resolution.updatedPlayer;

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: {
      stateUpdates: Record<string, Partial<PlayerStateDoc>>;
      summaryUpdates: Record<string, Partial<PlayerSummaryDoc>>;
    } | null = null;
    let gameStatusOverride: string | null = null;
    let endGameBonusResults: GameDoc["endGameBonusResults"] = null;

    if (resolution.roundComplete) {
      const players: Record<string, PlayerSnapshot> = {};
      await Promise.all(
        game.activePlayerOrder.map(async (activePlayerId) => {
          if (activePlayerId === playerId) {
            players[activePlayerId] = {
              ...resolvedPlayer,
            };
            return;
          }
          const playerStateSnap = await transaction.get(
            getPlayerStateRef(gameId, activePlayerId)
          );
          assertCondition(playerStateSnap.exists(), "Player not found.");
          players[activePlayerId] = {
            ...(playerStateSnap.data() as PlayerStateDoc),
          };
        })
      );

      const scoring = computeRoundScores(
        game.activePlayerOrder,
        players,
        resolution.endingPlayerId,
        rowClear,
        Boolean(game.spikeMode && game.spikeEndGameBonuses !== false)
      );
      roundScores = scoring.roundScores;
      scoreUpdates = {
        stateUpdates: scoring.stateUpdates,
        summaryUpdates: scoring.summaryUpdates,
      };
      gameStatusOverride = scoring.isGameComplete ? "game-complete" : "round-complete";
      endGameBonusResults = scoring.endGameBonusResults;
    }

    transaction.update(playerStateRef, {
      grid: resolvedPlayer.grid,
      revealed: resolvedPlayer.revealed,
      pendingDraw: null,
      pendingDrawSource: null,
      mistTurnsRemaining: resolvedPlayer.mistTurnsRemaining ?? null,
      sprintTurnsRemaining: resolvedPlayer.sprintTurnsRemaining ?? null,
      pointsClearedFromRows: resolvedPlayer.pointsClearedFromRows ?? 0,
      pointsDiscarded: resolvedPlayer.pointsDiscarded ?? 0,
    });
    const publicSummaryUpdates = getPublicSummaryUpdates(
      player.mistTurnsRemaining,
      resolvedPlayer
    );
    transaction.update(playerSummaryRef, {
      ...(publicSummaryUpdates ?? {}),
      ...getPendingSummaryUpdates(null, null),
      ...getMistSummaryUpdates(resolvedPlayer.mistTurnsRemaining),
      ...getSprintSummaryUpdates(resolvedPlayer.sprintTurnsRemaining),
      pointsClearedFromRows: resolvedPlayer.pointsClearedFromRows ?? 0,
      pointsDiscarded: resolvedPlayer.pointsDiscarded ?? 0,
    });
    transaction.update(gameRef, {
      discard,
      lastTurnPlayerId: playerId,
      lastTurnAction,
      lastTurnActionAt: serverTimestamp(),
      lastClearType,
      lastClearTypeAt: serverTimestamp(),
      ...resolution.gameUpdates,
      ...(gameStatusOverride ? { status: gameStatusOverride } : {}),
      ...(roundScores ? { roundScores } : {}),
      ...(endGameBonusResults ? { endGameBonusResults } : {}),
    });

    if (scoreUpdates) {
      Object.entries(scoreUpdates.stateUpdates).forEach(([targetPlayerId, updates]) => {
        transaction.update(getPlayerStateRef(gameId, targetPlayerId), updates);
      });
      Object.entries(scoreUpdates.summaryUpdates).forEach(([targetPlayerId, updates]) => {
        transaction.update(getPlayerSummaryRef(gameId, targetPlayerId), updates);
      });
    }
  });
};

export const discardPendingDraw = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);
  const playerStateRef = getPlayerStateRef(gameId, playerId);
  const playerSummaryRef = getPlayerSummaryRef(gameId, playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "resolve-draw", "Not in resolve draw phase.");

    const playerSnap = await transaction.get(playerStateRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerStateDoc;
    assertCondition(
      (player.sprintTurnsRemaining ?? 0) <= 0,
      "Cannot discard or reveal while sprinting."
    );
    assertCondition(player.pendingDraw != null, "No pending draw to discard.");
    assertCondition(!isItemCard(player.pendingDraw), "Pending draw is an item.");

    const discard = [...game.discard, player.pendingDraw];

    transaction.update(playerStateRef, { pendingDraw: null, pendingDrawSource: null });
    transaction.update(playerSummaryRef, getPendingSummaryUpdates(null, null));
    transaction.update(gameRef, { discard, turnPhase: "resolve" });
  });
};

export const discardItemForReveal = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);
  const playerStateRef = getPlayerStateRef(gameId, playerId);
  const playerSummaryRef = getPlayerSummaryRef(gameId, playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "resolve-item", "Not in item resolve phase.");

    const playerSnap = await transaction.get(playerStateRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerStateDoc;
    assertCondition(
      (player.sprintTurnsRemaining ?? 0) <= 0,
      "Cannot discard or reveal while sprinting."
    );
    const pendingDraw = player.pendingDraw;
    assertItemCard(pendingDraw, "No item to discard.");
    assertCondition(
      player.pendingDrawSource === "deck",
      "Cannot discard a discard pile item to reveal."
    );

    const discard = [...game.discard, pendingDraw];
    const isMistItem = pendingDraw.code === "F";
    const updatedPlayer = isMistItem
      ? {
          ...player,
          mistTurnsRemaining: null,
        }
      : player;
    const publicSummaryUpdates = isMistItem
      ? getPublicSummaryUpdates(player.mistTurnsRemaining, updatedPlayer)
      : null;

    transaction.update(playerStateRef, {
      pendingDraw: null,
      pendingDrawSource: null,
      ...(isMistItem ? { mistTurnsRemaining: null } : {}),
    });
    transaction.update(playerSummaryRef, {
      ...(publicSummaryUpdates ?? {}),
      ...getPendingSummaryUpdates(null, null),
      ...(isMistItem ? getMistSummaryUpdates(updatedPlayer.mistTurnsRemaining) : {}),
    });
    transaction.update(gameRef, { discard, turnPhase: "resolve", selectedDiscardPlayerId: null });
  });
};

export const useItemCard = async (
  gameId: string,
  playerId: string,
  usage: ItemUsage
) => {
  const gameRef = doc(db, "games", gameId);
  const playerStateRef = getPlayerStateRef(gameId, playerId);
  const playerSummaryRef = getPlayerSummaryRef(gameId, playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "resolve-item", "Not in item resolve phase.");

    const playerSnap = await transaction.get(playerStateRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerStateDoc;
    assertItemCodeMatch(player.pendingDraw, usage.code);

    const pendingItem = player.pendingDraw as ItemCard;
    const basePlayers = new Map<string, PlayerStateDoc>([[playerId, player]]);
    const playersToUpdate = new Map<string, PlayerStateDoc>([[playerId, player]]);
    const affectedPlayerIds = new Set<string>();
    let nextDeck = [...game.deck];
    let nextSkipNextTurnPlayerIds = new Set(game.skipNextTurnPlayerIds ?? []);

    const loadPlayer = async (targetPlayerId: string) => {
      assertCondition(
        game.activePlayerOrder.includes(targetPlayerId),
        "Target player is not in this game."
      );
      const existing = playersToUpdate.get(targetPlayerId);
      if (existing) {
        return existing;
      }
      const targetSnap = await transaction.get(getPlayerStateRef(gameId, targetPlayerId));
      assertCondition(targetSnap.exists(), "Player not found.");
      const targetPlayer = targetSnap.data() as PlayerStateDoc;
      basePlayers.set(targetPlayerId, targetPlayer);
      playersToUpdate.set(targetPlayerId, targetPlayer);
      return targetPlayer;
    };

    switch (usage.code) {
      case "A": {
        assertCondition(
          usage.target.playerId === playerId,
          "Item A must target your own grid."
        );
        const targetPlayer = await loadPlayer(usage.target.playerId);
        validateCardSlot(targetPlayer, usage.target.index);
        const targetCard = targetPlayer.grid[usage.target.index];
        assertNumberCard(targetCard, "Target card must be a number.");

        nextDeck = shuffleDeck([...nextDeck, targetCard]);
        const replacement = drawRandomNumberCard(nextDeck);

        const nextGrid = [...targetPlayer.grid];
        nextGrid[usage.target.index] = replacement;
        playersToUpdate.set(usage.target.playerId, {
          ...targetPlayer,
          grid: nextGrid,
        });
        affectedPlayerIds.add(usage.target.playerId);
        break;
      }
      case "C": {
        assertCondition(
          usage.target.playerId === playerId,
          "Item C must target your own grid."
        );
        const targetPlayer = await loadPlayer(usage.target.playerId);
        validateCardSlot(targetPlayer, usage.target.index);
        assertCondition(Number.isInteger(usage.value), "Item value must be an integer.");
        assertCondition(usage.value >= -2 && usage.value <= 12, "Item value is out of range.");

        const nextGrid = [...targetPlayer.grid];
        nextGrid[usage.target.index] = usage.value;
        playersToUpdate.set(usage.target.playerId, {
          ...targetPlayer,
          grid: nextGrid,
        });
        affectedPlayerIds.add(usage.target.playerId);
        break;
      }
      case "F": {
        playersToUpdate.set(playerId, {
          ...player,
          mistTurnsRemaining: 6,
        });
        break;
      }
      case "G": {
        playersToUpdate.set(playerId, {
          ...player,
          sprintTurnsRemaining: 4,
        });
        break;
      }
      case "E": {
        assertCondition(
          usage.first.playerId === playerId,
          "Item E must swap cards on your own grid."
        );
        assertCondition(
          usage.second.playerId === playerId,
          "Item E must swap cards on your own grid."
        );
        const firstPlayer = await loadPlayer(usage.first.playerId);
        const secondPlayer = await loadPlayer(usage.second.playerId);
        validateCardSlot(firstPlayer, usage.first.index);
        validateCardSlot(secondPlayer, usage.second.index);

        if (usage.first.playerId === usage.second.playerId) {
          const nextGrid = [...firstPlayer.grid];
          const nextRevealed = [...firstPlayer.revealed];
          const tempCard = nextGrid[usage.first.index];
          const tempReveal = nextRevealed[usage.first.index];
          nextGrid[usage.first.index] = nextGrid[usage.second.index];
          nextRevealed[usage.first.index] = nextRevealed[usage.second.index];
          nextGrid[usage.second.index] = tempCard;
          nextRevealed[usage.second.index] = tempReveal;
          playersToUpdate.set(usage.first.playerId, {
            ...firstPlayer,
            grid: nextGrid,
            revealed: nextRevealed,
          });
          affectedPlayerIds.add(usage.first.playerId);
        } else {
          const firstGrid = [...firstPlayer.grid];
          const firstRevealed = [...firstPlayer.revealed];
          const secondGrid = [...secondPlayer.grid];
          const secondRevealed = [...secondPlayer.revealed];

          const tempCard = firstGrid[usage.first.index];
          const tempReveal = firstRevealed[usage.first.index];
          firstGrid[usage.first.index] = secondGrid[usage.second.index];
          firstRevealed[usage.first.index] = secondRevealed[usage.second.index];
          secondGrid[usage.second.index] = tempCard;
          secondRevealed[usage.second.index] = tempReveal;

          playersToUpdate.set(usage.first.playerId, {
            ...firstPlayer,
            grid: firstGrid,
            revealed: firstRevealed,
          });
          playersToUpdate.set(usage.second.playerId, {
            ...secondPlayer,
            grid: secondGrid,
            revealed: secondRevealed,
          });
          affectedPlayerIds.add(usage.first.playerId);
          affectedPlayerIds.add(usage.second.playerId);
        }
        break;
      }
      default:
        throw new Error("Unknown item card.");
    }

    const updatedPlayers: Record<string, PlayerStateDoc> = {};
    const clearedItemDiscards: Card[] = [];
    let clearedRow = false;
    let clearedColumn = false;
    playersToUpdate.forEach((targetPlayer, targetPlayerId) => {
      if (affectedPlayerIds.has(targetPlayerId)) {
        const cleared = clearPlayerMatches(
          targetPlayer,
          Boolean(game.spikeMode && game.spikeRowClear)
        );
        updatedPlayers[targetPlayerId] = cleared.player;
        if (cleared.clearedCards.length > 0) {
          clearedItemDiscards.push(...cleared.clearedCards);
        }
        clearedRow = clearedRow || cleared.clearedRow;
        clearedColumn = clearedColumn || cleared.clearedColumn;
      } else {
        updatedPlayers[targetPlayerId] = targetPlayer;
      }
    });

    const updatedCurrentPlayer = updatedPlayers[playerId] ?? player;
    const lastClearType = getClearType(clearedRow, clearedColumn);
    const lastTurnAction = describeItemAction(usage);
    const resolution = resolveTurn(
      { ...game, skipNextTurnPlayerIds: Array.from(nextSkipNextTurnPlayerIds) },
      playerId,
      updatedCurrentPlayer
    );
    const resolvedPlayer = resolution.updatedPlayer;

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: {
      stateUpdates: Record<string, Partial<PlayerStateDoc>>;
      summaryUpdates: Record<string, Partial<PlayerSummaryDoc>>;
    } | null = null;
    let gameStatusOverride: string | null = null;
    let endGameBonusResults: GameDoc["endGameBonusResults"] = null;

    if (resolution.roundComplete) {
      const playersSnapshot: Record<string, PlayerSnapshot> = {};
      await Promise.all(
        game.activePlayerOrder.map(async (activePlayerId) => {
          if (updatedPlayers[activePlayerId]) {
            playersSnapshot[activePlayerId] = {
              ...(activePlayerId === playerId ? resolvedPlayer : updatedPlayers[activePlayerId]),
            };
            return;
          }
          const playerStateSnap = await transaction.get(
            getPlayerStateRef(gameId, activePlayerId)
          );
          assertCondition(playerStateSnap.exists(), "Player not found.");
          playersSnapshot[activePlayerId] = {
            ...(playerStateSnap.data() as PlayerStateDoc),
          };
        })
      );

      const scoring = computeRoundScores(
        game.activePlayerOrder,
        playersSnapshot,
        resolution.endingPlayerId,
        Boolean(game.spikeMode && game.spikeRowClear),
        Boolean(game.spikeMode && game.spikeEndGameBonuses !== false)
      );
      roundScores = scoring.roundScores;
      scoreUpdates = {
        stateUpdates: scoring.stateUpdates,
        summaryUpdates: scoring.summaryUpdates,
      };
      gameStatusOverride = scoring.isGameComplete ? "game-complete" : "round-complete";
      endGameBonusResults = scoring.endGameBonusResults;
    }

    transaction.update(playerStateRef, {
      grid: resolvedPlayer.grid,
      revealed: resolvedPlayer.revealed,
      pendingDraw: null,
      pendingDrawSource: null,
      mistTurnsRemaining: resolvedPlayer.mistTurnsRemaining ?? null,
      sprintTurnsRemaining: resolvedPlayer.sprintTurnsRemaining ?? null,
      pointsClearedFromRows: resolvedPlayer.pointsClearedFromRows ?? 0,
      pointsDiscarded: resolvedPlayer.pointsDiscarded ?? 0,
    });
    const publicSummaryUpdates = getPublicSummaryUpdates(
      player.mistTurnsRemaining,
      resolvedPlayer
    );
    transaction.update(playerSummaryRef, {
      ...(publicSummaryUpdates ?? {}),
      ...getPendingSummaryUpdates(null, null),
      ...getMistSummaryUpdates(resolvedPlayer.mistTurnsRemaining),
      ...getSprintSummaryUpdates(resolvedPlayer.sprintTurnsRemaining),
      pointsClearedFromRows: resolvedPlayer.pointsClearedFromRows ?? 0,
      pointsDiscarded: resolvedPlayer.pointsDiscarded ?? 0,
    });
    const updatedDiscard =
      clearedItemDiscards.length > 0 ? [...game.discard, ...clearedItemDiscards] : null;

    transaction.update(gameRef, {
      deck: nextDeck,
      graveyard: [...(game.graveyard ?? []), pendingItem],
      selectedDiscardPlayerId: null,
      lastTurnPlayerId: playerId,
      lastTurnAction,
      lastTurnActionAt: serverTimestamp(),
      lastClearType,
      lastClearTypeAt: serverTimestamp(),
      ...resolution.gameUpdates,
      ...(updatedDiscard ? { discard: updatedDiscard } : {}),
      ...(gameStatusOverride ? { status: gameStatusOverride } : {}),
      ...(roundScores ? { roundScores } : {}),
      ...(endGameBonusResults ? { endGameBonusResults } : {}),
    });

    Object.entries(updatedPlayers).forEach(([targetPlayerId, updatedPlayer]) => {
      if (targetPlayerId === playerId) {
        return;
      }
      transaction.update(getPlayerStateRef(gameId, targetPlayerId), {
        grid: updatedPlayer.grid,
        revealed: updatedPlayer.revealed,
      });
      const previousPlayer = basePlayers.get(targetPlayerId) ?? updatedPlayer;
      const targetPublicSummaryUpdates = getPublicSummaryUpdates(
        previousPlayer.mistTurnsRemaining,
        updatedPlayer
      );
      if (targetPublicSummaryUpdates) {
        transaction.update(
          getPlayerSummaryRef(gameId, targetPlayerId),
          targetPublicSummaryUpdates
        );
      }
    });

    if (scoreUpdates) {
      Object.entries(scoreUpdates.stateUpdates).forEach(([targetPlayerId, updates]) => {
        transaction.update(getPlayerStateRef(gameId, targetPlayerId), updates);
      });
      Object.entries(scoreUpdates.summaryUpdates).forEach(([targetPlayerId, updates]) => {
        transaction.update(getPlayerSummaryRef(gameId, targetPlayerId), updates);
      });
    }
  });
};

export const revealAfterDiscard = async (
  gameId: string,
  playerId: string,
  targetIndex: number
) => {
  const gameRef = doc(db, "games", gameId);
  const playerStateRef = getPlayerStateRef(gameId, playerId);
  const playerSummaryRef = getPlayerSummaryRef(gameId, playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "resolve", "Not in resolve phase.");

    const playerSnap = await transaction.get(playerStateRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerStateDoc;
    assertCondition(
      (player.sprintTurnsRemaining ?? 0) <= 0,
      "Cannot discard or reveal while sprinting."
    );
    validateGridIndex(player, targetIndex);
    assertCondition(!player.revealed[targetIndex], "Slot already revealed.");
    assertCondition(player.grid[targetIndex] !== null, "Slot is empty.");

    const revealed = [...player.revealed];
    revealed[targetIndex] = true;

    const rowClear = Boolean(game.spikeMode && game.spikeRowClear);
    const cleared = clearMatchesAtIndex([...player.grid], revealed, targetIndex, rowClear);
    const clearedDiscard =
      cleared.clearedCards.length > 0 ? [...game.discard, ...cleared.clearedCards] : null;

    const updatedPlayer: PlayerStateDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
      pointsClearedFromRows: (player.pointsClearedFromRows ?? 0) + cleared.rowClearedPoints,
      pointsDiscarded: player.pointsDiscarded ?? 0,
    };
    const lastClearType = getClearType(cleared.clearedRow, cleared.clearedColumn);

    const lastTurnAction = "discarded drawn card and revealed card.";
    const resolution = resolveTurn(game, playerId, updatedPlayer);
    const resolvedPlayer = resolution.updatedPlayer;

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: {
      stateUpdates: Record<string, Partial<PlayerStateDoc>>;
      summaryUpdates: Record<string, Partial<PlayerSummaryDoc>>;
    } | null = null;
    let gameStatusOverride: string | null = null;
    let endGameBonusResults: GameDoc["endGameBonusResults"] = null;

    if (resolution.roundComplete) {
      const players: Record<string, PlayerSnapshot> = {};
      await Promise.all(
        game.activePlayerOrder.map(async (activePlayerId) => {
          if (activePlayerId === playerId) {
            players[activePlayerId] = {
              ...resolvedPlayer,
            };
            return;
          }
          const playerStateSnap = await transaction.get(
            getPlayerStateRef(gameId, activePlayerId)
          );
          assertCondition(playerStateSnap.exists(), "Player not found.");
          players[activePlayerId] = {
            ...(playerStateSnap.data() as PlayerStateDoc),
          };
        })
      );

      const scoring = computeRoundScores(
        game.activePlayerOrder,
        players,
        resolution.endingPlayerId,
        rowClear,
        Boolean(game.spikeMode && game.spikeEndGameBonuses !== false)
      );
      roundScores = scoring.roundScores;
      scoreUpdates = {
        stateUpdates: scoring.stateUpdates,
        summaryUpdates: scoring.summaryUpdates,
      };
      gameStatusOverride = scoring.isGameComplete ? "game-complete" : "round-complete";
      endGameBonusResults = scoring.endGameBonusResults;
    }

    transaction.update(playerStateRef, {
      grid: resolvedPlayer.grid,
      revealed: resolvedPlayer.revealed,
      mistTurnsRemaining: resolvedPlayer.mistTurnsRemaining ?? null,
      sprintTurnsRemaining: resolvedPlayer.sprintTurnsRemaining ?? null,
      pointsClearedFromRows: resolvedPlayer.pointsClearedFromRows ?? 0,
      pointsDiscarded: resolvedPlayer.pointsDiscarded ?? 0,
    });
    const publicSummaryUpdates = getPublicSummaryUpdates(
      player.mistTurnsRemaining,
      resolvedPlayer
    );
    transaction.update(playerSummaryRef, {
      ...(publicSummaryUpdates ?? {}),
      ...getMistSummaryUpdates(resolvedPlayer.mistTurnsRemaining),
      ...getSprintSummaryUpdates(resolvedPlayer.sprintTurnsRemaining),
      pointsClearedFromRows: resolvedPlayer.pointsClearedFromRows ?? 0,
      pointsDiscarded: resolvedPlayer.pointsDiscarded ?? 0,
    });
    transaction.update(gameRef, {
      lastTurnPlayerId: playerId,
      lastTurnAction,
      lastTurnActionAt: serverTimestamp(),
      lastClearType,
      lastClearTypeAt: serverTimestamp(),
      ...resolution.gameUpdates,
      ...(clearedDiscard ? { discard: clearedDiscard } : {}),
      ...(gameStatusOverride ? { status: gameStatusOverride } : {}),
      ...(roundScores ? { roundScores } : {}),
      ...(endGameBonusResults ? { endGameBonusResults } : {}),
    });

    if (scoreUpdates) {
      Object.entries(scoreUpdates.stateUpdates).forEach(([targetPlayerId, updates]) => {
        transaction.update(getPlayerStateRef(gameId, targetPlayerId), updates);
      });
      Object.entries(scoreUpdates.summaryUpdates).forEach(([targetPlayerId, updates]) => {
        transaction.update(getPlayerSummaryRef(gameId, targetPlayerId), updates);
      });
    }
  });
};

export const discardAndRevealPendingDraw = async (
  gameId: string,
  playerId: string,
  targetIndex: number
) => {
  const gameRef = doc(db, "games", gameId);
  const playerStateRef = getPlayerStateRef(gameId, playerId);
  const playerSummaryRef = getPlayerSummaryRef(gameId, playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "resolve-draw", "Not in resolve draw phase.");

    const playerSnap = await transaction.get(playerStateRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerStateDoc;
    assertCondition(
      (player.sprintTurnsRemaining ?? 0) <= 0,
      "Cannot discard or reveal while sprinting."
    );
    validateGridIndex(player, targetIndex);
    assertCondition(!player.revealed[targetIndex], "Slot already revealed.");
    assertCondition(player.grid[targetIndex] !== null, "Slot is empty.");
    assertCondition(player.pendingDraw != null, "No pending draw to discard.");
    assertCondition(!isItemCard(player.pendingDraw), "Pending draw is an item.");

    const discard = [...game.discard, player.pendingDraw];
    const revealed = [...player.revealed];
    revealed[targetIndex] = true;

    const rowClear = Boolean(game.spikeMode && game.spikeRowClear);
    const cleared = clearMatchesAtIndex([...player.grid], revealed, targetIndex, rowClear);
    if (cleared.clearedCards.length > 0) {
      discard.push(...cleared.clearedCards);
    }

    const updatedPlayer: PlayerStateDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
      pendingDraw: null,
      pendingDrawSource: null,
      pointsClearedFromRows: (player.pointsClearedFromRows ?? 0) + cleared.rowClearedPoints,
      pointsDiscarded:
        (player.pointsDiscarded ?? 0) + getNumberCardPoints(player.pendingDraw),
    };
    const lastClearType = getClearType(cleared.clearedRow, cleared.clearedColumn);

    const lastTurnAction = "discarded drawn card and revealed card.";
    const resolution = resolveTurn(game, playerId, updatedPlayer);
    const resolvedPlayer = resolution.updatedPlayer;

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: {
      stateUpdates: Record<string, Partial<PlayerStateDoc>>;
      summaryUpdates: Record<string, Partial<PlayerSummaryDoc>>;
    } | null = null;
    let gameStatusOverride: string | null = null;
    let endGameBonusResults: GameDoc["endGameBonusResults"] = null;

    if (resolution.roundComplete) {
      const players: Record<string, PlayerSnapshot> = {};
      await Promise.all(
        game.activePlayerOrder.map(async (activePlayerId) => {
          if (activePlayerId === playerId) {
            players[activePlayerId] = {
              ...resolvedPlayer,
            };
            return;
          }
          const playerStateSnap = await transaction.get(
            getPlayerStateRef(gameId, activePlayerId)
          );
          assertCondition(playerStateSnap.exists(), "Player not found.");
          players[activePlayerId] = {
            ...(playerStateSnap.data() as PlayerStateDoc),
          };
        })
      );

      const scoring = computeRoundScores(
        game.activePlayerOrder,
        players,
        resolution.endingPlayerId,
        rowClear,
        Boolean(game.spikeMode && game.spikeEndGameBonuses !== false)
      );
      roundScores = scoring.roundScores;
      scoreUpdates = {
        stateUpdates: scoring.stateUpdates,
        summaryUpdates: scoring.summaryUpdates,
      };
      gameStatusOverride = scoring.isGameComplete ? "game-complete" : "round-complete";
      endGameBonusResults = scoring.endGameBonusResults;
    }

    transaction.update(playerStateRef, {
      grid: resolvedPlayer.grid,
      revealed: resolvedPlayer.revealed,
      pendingDraw: null,
      pendingDrawSource: null,
      mistTurnsRemaining: resolvedPlayer.mistTurnsRemaining ?? null,
      sprintTurnsRemaining: resolvedPlayer.sprintTurnsRemaining ?? null,
      pointsClearedFromRows: resolvedPlayer.pointsClearedFromRows ?? 0,
      pointsDiscarded: resolvedPlayer.pointsDiscarded ?? 0,
    });
    const publicSummaryUpdates = getPublicSummaryUpdates(
      player.mistTurnsRemaining,
      resolvedPlayer
    );
    transaction.update(playerSummaryRef, {
      ...(publicSummaryUpdates ?? {}),
      ...getPendingSummaryUpdates(null, null),
      ...getMistSummaryUpdates(resolvedPlayer.mistTurnsRemaining),
      ...getSprintSummaryUpdates(resolvedPlayer.sprintTurnsRemaining),
      pointsClearedFromRows: resolvedPlayer.pointsClearedFromRows ?? 0,
      pointsDiscarded: resolvedPlayer.pointsDiscarded ?? 0,
    });
    transaction.update(gameRef, {
      discard,
      selectedDiscardPlayerId: null,
      lastTurnPlayerId: playerId,
      lastTurnAction,
      lastTurnActionAt: serverTimestamp(),
      lastClearType,
      lastClearTypeAt: serverTimestamp(),
      ...resolution.gameUpdates,
      ...(gameStatusOverride ? { status: gameStatusOverride } : {}),
      ...(roundScores ? { roundScores } : {}),
      ...(endGameBonusResults ? { endGameBonusResults } : {}),
    });

    if (scoreUpdates) {
      Object.entries(scoreUpdates.stateUpdates).forEach(([targetPlayerId, updates]) => {
        transaction.update(getPlayerStateRef(gameId, targetPlayerId), updates);
      });
      Object.entries(scoreUpdates.summaryUpdates).forEach(([targetPlayerId, updates]) => {
        transaction.update(getPlayerSummaryRef(gameId, targetPlayerId), updates);
      });
    }
  });
};

export const startNextRound = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.status === "round-complete", "Round is not complete yet.");
    assertCondition(game.hostId === playerId, "Only the host can start the next round.");

    const playerOrder = game.activePlayerOrder;
    assertCondition(playerOrder.length > 0, "No players are active in this game.");
    const readyPlayerIds = game.readyPlayerIds ?? [];
    const readyPlayerSet = new Set(readyPlayerIds);
    const allPlayersReady = playerOrder.every((activePlayerId) => readyPlayerSet.has(activePlayerId));
    assertCondition(allPlayersReady, "All players must be ready to start the next round.");

    const spikeMode = Boolean(game.spikeMode);
    const spikeItemCount = game.spikeItemCount ?? "low";
    const spikeRowClear = Boolean(game.spikeRowClear);
    const spikeEndGameBonuses = game.spikeEndGameBonuses !== false;
    let shuffledDeck: Card[] = shuffleDeck(createSkyjoDeck());
    const playerGrids = new Map<string, number[]>();

    playerOrder.forEach((targetPlayerId) => {
      const grid: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        const card = shuffledDeck.pop();
        if (card === undefined) {
          throw new Error("Not enough cards to deal the next round.");
        }
        if (typeof card !== "number") {
          throw new Error("Expected a number card while dealing the next round.");
        }
        grid.push(card);
      }
      playerGrids.set(targetPlayerId, grid);
    });

    if (spikeMode) {
      shuffledDeck = shuffleDeck([...shuffledDeck, ...createItemCards(spikeItemCount)]);
    }

    const discardCard = shuffledDeck.pop();
    assertCondition(discardCard !== undefined, "Deck is empty after dealing.");
    const roundScores = game.roundScores ?? {};
    const highestRoundScore = Object.values(roundScores).reduce<number | null>(
      (highest, score) => (highest === null || score > highest ? score : highest),
      null
    );
    const startingPlayerId =
      playerOrder.find((targetPlayerId) => roundScores[targetPlayerId] === highestRoundScore) ??
      playerOrder[0];

    transaction.update(gameRef, {
      status: "playing",
      roundNumber: (game.roundNumber ?? 1) + 1,
      currentPlayerId: startingPlayerId,
      turnPhase: "choose-draw",
      deck: shuffledDeck,
      discard: [discardCard],
      graveyard: [],
      spikeMode,
      ...(spikeMode ? { spikeItemCount, spikeRowClear, spikeEndGameBonuses } : {}),
      endingPlayerId: null,
      finalTurnRemainingIds: null,
      lastTurnPlayerId: null,
      lastTurnAction: null,
      lastClearType: null,
      lastClearTypeAt: null,
      skipNextTurnPlayerIds: [],
      roundScores: deleteField(),
      readyPlayerIds: [],
    });

    playerOrder.forEach((targetPlayerId) => {
      const initialRevealed = Array.from({ length: 12 }, () => false);
      transaction.update(getPlayerStateRef(gameId, targetPlayerId), {
        grid: playerGrids.get(targetPlayerId) ?? [],
        revealed: initialRevealed,
        pendingDraw: null,
        pendingDrawSource: null,
        mistTurnsRemaining: null,
        sprintTurnsRemaining: null,
      });
      transaction.update(getPlayerSummaryRef(gameId, targetPlayerId), {
        isReady: false,
        roundScore: 0,
        revealed: initialRevealed,
        publicGrid: Array.from({ length: 12 }, () => null),
        revealedCount: 0,
        pendingDraw: null,
        pendingDrawSource: null,
        mistTurnsRemaining: null,
        sprintTurnsRemaining: null,
      });
    });
  });
};

export const readyForNextRound = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);
  const playerSummaryRef = getPlayerSummaryRef(gameId, playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;
    assertCondition(game.status === "round-complete", "Round is not complete yet.");

    const playerSnap = await transaction.get(playerSummaryRef);
    assertCondition(playerSnap.exists(), "Player not found.");

    const readyPlayerIds = new Set(game.readyPlayerIds ?? []);
    readyPlayerIds.add(playerId);

    transaction.update(gameRef, { readyPlayerIds: Array.from(readyPlayerIds) });
    transaction.update(playerSummaryRef, { isReady: true });
  });
};
