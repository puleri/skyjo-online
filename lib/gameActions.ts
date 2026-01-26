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
  endingPlayerId?: string | null;
  finalTurnRemainingIds?: string[] | null;
  selectedDiscardPlayerId?: string | null;
  status?: string;
  roundScores?: Record<string, number>;
  lastTurnPlayerId?: string | null;
  lastTurnAction?: string | null;
  lastTurnActionAt?: unknown;
  skipNextTurnPlayerIds?: string[] | null;
};

type PlayerDoc = {
  grid: Array<Card | null>;
  revealed: boolean[];
  pendingDraw?: Card | null;
  pendingDrawSource?: "deck" | "discard" | null;
  isReady?: boolean;
  roundScore?: number;
  totalScore?: number;
};

const columns = 4;

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
  const columnIndices = getColumnIndices(index);
  if (isLineMatch(grid, revealed, columnIndices)) {
    columnIndices.forEach((columnIndex) => matchedIndices.add(columnIndex));
  }
  if (rowClear) {
    const rowIndices = getRowIndices(index);
    if (isLineMatch(grid, revealed, rowIndices)) {
      rowIndices.forEach((rowIndex) => matchedIndices.add(rowIndex));
    }
  }
  if (matchedIndices.size === 0) {
    return { grid, revealed, clearedCards: [] as Card[] };
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
  return { grid: nextGrid, revealed: nextRevealed, clearedCards };
};

const clearMatchedLines = (grid: Array<Card | null>, revealed: boolean[], rowClear: boolean) => {
  const nextGrid = [...grid];
  const nextRevealed = [...revealed];
  const matchedIndices = new Set<number>();
  for (let column = 0; column < columns; column += 1) {
    const columnIndices = getColumnIndices(column);
    if (isLineMatch(grid, revealed, columnIndices)) {
      columnIndices.forEach((columnIndex) => matchedIndices.add(columnIndex));
    }
  }
  if (rowClear) {
    const rowCount = Math.floor(grid.length / columns);
    for (let row = 0; row < rowCount; row += 1) {
      const rowIndices = Array.from({ length: columns }, (_, offset) => row * columns + offset);
      if (isLineMatch(grid, revealed, rowIndices)) {
        rowIndices.forEach((rowIndex) => matchedIndices.add(rowIndex));
      }
    }
  }
  matchedIndices.forEach((matchedIndex) => {
    nextGrid[matchedIndex] = null;
    nextRevealed[matchedIndex] = true;
  });
  return { grid: nextGrid, revealed: nextRevealed };
};

const allCardsRevealed = (revealed: boolean[]) => revealed.every(Boolean);

const calculateScore = (grid: Array<Card | null>) =>
  grid.reduce<number>((total, value) => total + (typeof value === "number" ? value : 0), 0);

const isItemCard = (card: Card | null | undefined): card is ItemCard =>
  card != null && typeof card === "object" && "kind" in card && card.kind === "item";

const assertNumberCard: (card: Card | null, message: string) => asserts card is number = (
  card,
  message
) => {
  assertCondition(typeof card === "number", message);
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

const shuffleGridPositions = (grid: Array<Card | null>, revealed: boolean[]) => {
  const combined = grid.map((card, index) => ({ card, revealed: revealed[index] }));
  const shuffled = shuffleDeck(combined);
  return {
    grid: shuffled.map((entry) => entry.card),
    revealed: shuffled.map((entry) => entry.revealed),
  };
};

const clearPlayerMatches = (player: PlayerDoc, rowClear: boolean) => {
  const cleared = clearMatchedLines([...player.grid], [...player.revealed], rowClear);
  return { ...player, grid: cleared.grid, revealed: cleared.revealed };
};

const validateGridIndex = (player: PlayerDoc, targetIndex: number) => {
  assertCondition(targetIndex >= 0 && targetIndex < player.grid.length, "Invalid index.");
};

const validateCardSlot = (player: PlayerDoc, targetIndex: number) => {
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
  | { code: "B" }
  | { code: "C"; target: ItemTarget; value: number }
  | { code: "D"; target: ItemTarget }
  | { code: "E"; first: ItemTarget; second: ItemTarget };

const describeItemAction = (usage: ItemUsage) => {
  switch (usage.code) {
    case "A":
      return "used item A to reroll a card.";
    case "B":
      return "used item B to shuffle their grid.";
    case "C":
      return `used item C to set a card to ${usage.value}.`;
    case "D":
      return "used item D to freeze a player.";
    case "E":
      return "used item E to swap two cards.";
    default:
      return "used an item.";
  }
};

type TurnResolution = {
  gameUpdates: Partial<GameDoc>;
  roundComplete: boolean;
  endingPlayerId: string | null;
  finalTurnRemainingIds: string[] | null;
};

const resolveTurn = (
  game: GameDoc,
  updatedPlayerId: string,
  updatedPlayer: PlayerDoc
): TurnResolution => {
  const activeOrder = game.activePlayerOrder;
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
    };
  }

  let nextPlayerId = getNextPlayerId(activeOrder, updatedPlayerId);
  let safetyCounter = 0;
  while (skipNextTurnPlayerIds.has(nextPlayerId) && safetyCounter < activeOrder.length) {
    skipNextTurnPlayerIds.delete(nextPlayerId);
    nextPlayerId = getNextPlayerId(activeOrder, nextPlayerId);
    safetyCounter += 1;
  }
  let refreshedDeck: Card[] | null = null;
  if (game.deck.length === 0) {
    const discardPile = game.discard;
    const remainingDiscard = discardPile.slice(0, -1);
    if (remainingDiscard.length > 0) {
      refreshedDeck = shuffleDeck(remainingDiscard);
    }
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
  };
};

const computeRoundScores = (
  activeOrder: string[],
  players: Record<string, PlayerDoc>,
  endingPlayerId: string | null,
  rowClear: boolean
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

  const playerUpdates: Record<string, Partial<PlayerDoc>> = {};
  const totalScores: number[] = [];
  activeOrder.forEach((playerId, index) => {
    const cleared = scoresByPlayer[index].cleared;
    const previousTotal = players[playerId].totalScore ?? 0;
    const totalScore = previousTotal + roundScores[playerId];
    totalScores.push(totalScore);
    playerUpdates[playerId] = {
      grid: cleared.grid,
      revealed: cleared.revealed,
      isReady: false,
      roundScore: roundScores[playerId],
      totalScore,
    };
  });

  const isGameComplete = totalScores.some((totalScore) => totalScore >= 100);

  return { roundScores, playerUpdates, isGameComplete };
};

export const drawFromDiscard = async (
  gameId: string,
  playerId: string,
  targetIndex: number
) => {
  const gameRef = doc(db, "games", gameId);
  const playerRef = doc(db, "games", gameId, "players", playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "choose-draw", "Not in draw phase.");
    assertCondition(game.discard.length > 0, "Discard pile is empty.");

    const playerSnap = await transaction.get(playerRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerDoc;
    assertCondition(player.pendingDraw == null, "You already have a pending draw.");
    validateGridIndex(player, targetIndex);

    const discard = [...game.discard];
    const drawnCard = discard.pop();
    assertCondition(drawnCard !== undefined, "Discard pile is empty.");
    const drawn = drawnCard as Card;

    if (isItemCard(drawn)) {
      transaction.update(playerRef, { pendingDraw: drawn, pendingDrawSource: "discard" });
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

    const updatedPlayer: PlayerDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
    };

    const lastTurnAction = "took discard pile card and swapped card.";
    const resolution = resolveTurn(game, playerId, updatedPlayer);

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: Record<string, Partial<PlayerDoc>> | null = null;
    let gameStatusOverride: string | null = null;

    if (resolution.roundComplete) {
      const players: Record<string, PlayerDoc> = {};
      await Promise.all(
        game.activePlayerOrder.map(async (activePlayerId) => {
          if (activePlayerId === playerId) {
            players[activePlayerId] = updatedPlayer;
            return;
          }
          const playerDocRef = doc(db, "games", gameId, "players", activePlayerId);
          const playerSnap = await transaction.get(playerDocRef);
          assertCondition(playerSnap.exists(), "Player not found.");
          players[activePlayerId] = playerSnap.data() as PlayerDoc;
        })
      );

      const scoring = computeRoundScores(
        game.activePlayerOrder,
        players,
        resolution.endingPlayerId,
        rowClear
      );
      roundScores = scoring.roundScores;
      scoreUpdates = scoring.playerUpdates;
      gameStatusOverride = scoring.isGameComplete ? "game-complete" : "round-complete";
    }

    transaction.update(playerRef, {
      grid: cleared.grid,
      revealed: cleared.revealed,
      pendingDraw: null,
      pendingDrawSource: null,
    });
    transaction.update(gameRef, {
      discard,
      selectedDiscardPlayerId: null,
      lastTurnPlayerId: playerId,
      lastTurnAction,
      lastTurnActionAt: serverTimestamp(),
      ...resolution.gameUpdates,
      ...(gameStatusOverride ? { status: gameStatusOverride } : {}),
      ...(roundScores ? { roundScores } : {}),
    });

    if (scoreUpdates) {
      Object.entries(scoreUpdates).forEach(([targetPlayerId, updates]) => {
        const targetRef = doc(db, "games", gameId, "players", targetPlayerId);
        transaction.update(targetRef, updates);
      });
    }
  });
};

export const drawFromDeck = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);
  const playerRef = doc(db, "games", gameId, "players", playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "choose-draw", "Not in draw phase.");
    assertCondition(game.deck.length > 0, "Deck is empty.");

    const playerSnap = await transaction.get(playerRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerDoc;
    assertCondition(player.pendingDraw == null, "You already have a pending draw.");

    const deck = [...game.deck];
    const drawnCard = deck.pop();
    assertCondition(drawnCard !== undefined, "Deck is empty.");
    const drawn = drawnCard as Card;

    transaction.update(playerRef, { pendingDraw: drawn, pendingDrawSource: "deck" });
    transaction.update(gameRef, {
      deck,
      turnPhase: isItemCard(drawn) ? "resolve-item" : "resolve-draw",
      selectedDiscardPlayerId: null,
    });
  });
};

export const selectDiscard = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "choose-draw", "Not in draw phase.");
    assertCondition(game.discard.length > 0, "Discard pile is empty.");

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
  const playerRef = doc(db, "games", gameId, "players", playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(
      game.turnPhase === "resolve-draw" || game.turnPhase === "choose-swap",
      "Not in swap phase."
    );

    const playerSnap = await transaction.get(playerRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerDoc;
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

    const updatedPlayer: PlayerDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
    };

    const lastTurnAction = "drew from deck and swapped card.";
    const resolution = resolveTurn(game, playerId, updatedPlayer);

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: Record<string, Partial<PlayerDoc>> | null = null;
    let gameStatusOverride: string | null = null;

    if (resolution.roundComplete) {
      const players: Record<string, PlayerDoc> = {};
      await Promise.all(
        game.activePlayerOrder.map(async (activePlayerId) => {
          if (activePlayerId === playerId) {
            players[activePlayerId] = updatedPlayer;
            return;
          }
          const playerDocRef = doc(db, "games", gameId, "players", activePlayerId);
          const playerSnap = await transaction.get(playerDocRef);
          assertCondition(playerSnap.exists(), "Player not found.");
          players[activePlayerId] = playerSnap.data() as PlayerDoc;
        })
      );

      const scoring = computeRoundScores(
        game.activePlayerOrder,
        players,
        resolution.endingPlayerId,
        rowClear
      );
      roundScores = scoring.roundScores;
      scoreUpdates = scoring.playerUpdates;
      gameStatusOverride = scoring.isGameComplete ? "game-complete" : "round-complete";
    }

    transaction.update(playerRef, {
      grid: cleared.grid,
      revealed: cleared.revealed,
      pendingDraw: null,
      pendingDrawSource: null,
    });
    transaction.update(gameRef, {
      discard,
      lastTurnPlayerId: playerId,
      lastTurnAction,
      lastTurnActionAt: serverTimestamp(),
      ...resolution.gameUpdates,
      ...(gameStatusOverride ? { status: gameStatusOverride } : {}),
      ...(roundScores ? { roundScores } : {}),
    });

    if (scoreUpdates) {
      Object.entries(scoreUpdates).forEach(([targetPlayerId, updates]) => {
        const targetRef = doc(db, "games", gameId, "players", targetPlayerId);
        transaction.update(targetRef, updates);
      });
    }
  });
};

export const discardPendingDraw = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);
  const playerRef = doc(db, "games", gameId, "players", playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "resolve-draw", "Not in resolve draw phase.");

    const playerSnap = await transaction.get(playerRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerDoc;
    assertCondition(player.pendingDraw != null, "No pending draw to discard.");
    assertCondition(!isItemCard(player.pendingDraw), "Pending draw is an item.");

    const discard = [...game.discard, player.pendingDraw];

    transaction.update(playerRef, { pendingDraw: null, pendingDrawSource: null });
    transaction.update(gameRef, { discard, turnPhase: "resolve" });
  });
};

export const discardItemForReveal = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);
  const playerRef = doc(db, "games", gameId, "players", playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "resolve-item", "Not in item resolve phase.");

    const playerSnap = await transaction.get(playerRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerDoc;
    assertCondition(isItemCard(player.pendingDraw), "No item to discard.");

    const discard = [...game.discard, player.pendingDraw];

    transaction.update(playerRef, { pendingDraw: null, pendingDrawSource: null });
    transaction.update(gameRef, { discard, turnPhase: "resolve", selectedDiscardPlayerId: null });
  });
};

export const useItemCard = async (
  gameId: string,
  playerId: string,
  usage: ItemUsage
) => {
  const gameRef = doc(db, "games", gameId);
  const playerRef = doc(db, "games", gameId, "players", playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "resolve-item", "Not in item resolve phase.");

    const playerSnap = await transaction.get(playerRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerDoc;
    assertItemCodeMatch(player.pendingDraw, usage.code);

    const pendingItem = player.pendingDraw as ItemCard;
    const playersToUpdate = new Map<string, PlayerDoc>([[playerId, player]]);
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
      const targetRef = doc(db, "games", gameId, "players", targetPlayerId);
      const targetSnap = await transaction.get(targetRef);
      assertCondition(targetSnap.exists(), "Player not found.");
      const targetPlayer = targetSnap.data() as PlayerDoc;
      playersToUpdate.set(targetPlayerId, targetPlayer);
      return targetPlayer;
    };

    switch (usage.code) {
      case "A": {
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
      case "B": {
        const shuffled = shuffleGridPositions(player.grid, player.revealed);
        playersToUpdate.set(playerId, { ...player, ...shuffled });
        affectedPlayerIds.add(playerId);
        break;
      }
      case "C": {
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
      case "D":
        const frozenPlayer = await loadPlayer(usage.target.playerId);
        validateGridIndex(frozenPlayer, usage.target.index);
        nextSkipNextTurnPlayerIds.add(usage.target.playerId);
        break;
      case "E": {
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

    const updatedPlayers: Record<string, PlayerDoc> = {};
    playersToUpdate.forEach((targetPlayer, targetPlayerId) => {
      if (affectedPlayerIds.has(targetPlayerId)) {
        updatedPlayers[targetPlayerId] = clearPlayerMatches(
          targetPlayer,
          Boolean(game.spikeMode && game.spikeRowClear)
        );
      } else {
        updatedPlayers[targetPlayerId] = targetPlayer;
      }
    });

    const updatedCurrentPlayer = updatedPlayers[playerId] ?? player;
    const lastTurnAction = describeItemAction(usage);
    const resolution = resolveTurn(
      { ...game, skipNextTurnPlayerIds: Array.from(nextSkipNextTurnPlayerIds) },
      playerId,
      updatedCurrentPlayer
    );

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: Record<string, Partial<PlayerDoc>> | null = null;
    let gameStatusOverride: string | null = null;

    if (resolution.roundComplete) {
      const playersSnapshot: Record<string, PlayerDoc> = {};
      await Promise.all(
        game.activePlayerOrder.map(async (activePlayerId) => {
          if (updatedPlayers[activePlayerId]) {
            playersSnapshot[activePlayerId] = updatedPlayers[activePlayerId];
            return;
          }
          const playerDocRef = doc(db, "games", gameId, "players", activePlayerId);
          const playerSnap = await transaction.get(playerDocRef);
          assertCondition(playerSnap.exists(), "Player not found.");
          playersSnapshot[activePlayerId] = playerSnap.data() as PlayerDoc;
        })
      );

      const scoring = computeRoundScores(
        game.activePlayerOrder,
        playersSnapshot,
        resolution.endingPlayerId,
        Boolean(game.spikeMode && game.spikeRowClear)
      );
      roundScores = scoring.roundScores;
      scoreUpdates = scoring.playerUpdates;
      gameStatusOverride = scoring.isGameComplete ? "game-complete" : "round-complete";
    }

    transaction.update(playerRef, {
      grid: updatedCurrentPlayer.grid,
      revealed: updatedCurrentPlayer.revealed,
      pendingDraw: null,
      pendingDrawSource: null,
    });
    transaction.update(gameRef, {
      deck: nextDeck,
      graveyard: [...(game.graveyard ?? []), pendingItem],
      selectedDiscardPlayerId: null,
      lastTurnPlayerId: playerId,
      lastTurnAction,
      lastTurnActionAt: serverTimestamp(),
      ...resolution.gameUpdates,
      ...(gameStatusOverride ? { status: gameStatusOverride } : {}),
      ...(roundScores ? { roundScores } : {}),
    });

    Object.entries(updatedPlayers).forEach(([targetPlayerId, updatedPlayer]) => {
      if (targetPlayerId === playerId) {
        return;
      }
      const targetRef = doc(db, "games", gameId, "players", targetPlayerId);
      transaction.update(targetRef, {
        grid: updatedPlayer.grid,
        revealed: updatedPlayer.revealed,
      });
    });

    if (scoreUpdates) {
      Object.entries(scoreUpdates).forEach(([targetPlayerId, updates]) => {
        const targetRef = doc(db, "games", gameId, "players", targetPlayerId);
        transaction.update(targetRef, updates);
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
  const playerRef = doc(db, "games", gameId, "players", playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;

    assertCondition(game.currentPlayerId === playerId, "Not your turn.");
    assertCondition(game.turnPhase === "resolve", "Not in resolve phase.");

    const playerSnap = await transaction.get(playerRef);
    assertCondition(playerSnap.exists(), "Player not found.");
    const player = playerSnap.data() as PlayerDoc;
    validateGridIndex(player, targetIndex);
    assertCondition(!player.revealed[targetIndex], "Slot already revealed.");
    assertCondition(player.grid[targetIndex] !== null, "Slot is empty.");

    const revealed = [...player.revealed];
    revealed[targetIndex] = true;

    const rowClear = Boolean(game.spikeMode && game.spikeRowClear);
    const cleared = clearMatchesAtIndex([...player.grid], revealed, targetIndex, rowClear);
    const clearedDiscard =
      cleared.clearedCards.length > 0 ? [...game.discard, ...cleared.clearedCards] : null;

    const updatedPlayer: PlayerDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
    };

    const lastTurnAction = "discarded drawn card and revealed card.";
    const resolution = resolveTurn(game, playerId, updatedPlayer);

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: Record<string, Partial<PlayerDoc>> | null = null;
    let gameStatusOverride: string | null = null;

    if (resolution.roundComplete) {
      const players: Record<string, PlayerDoc> = {};
      await Promise.all(
        game.activePlayerOrder.map(async (activePlayerId) => {
          if (activePlayerId === playerId) {
            players[activePlayerId] = updatedPlayer;
            return;
          }
          const playerDocRef = doc(db, "games", gameId, "players", activePlayerId);
          const playerSnap = await transaction.get(playerDocRef);
          assertCondition(playerSnap.exists(), "Player not found.");
          players[activePlayerId] = playerSnap.data() as PlayerDoc;
        })
      );

      const scoring = computeRoundScores(
        game.activePlayerOrder,
        players,
        resolution.endingPlayerId,
        rowClear
      );
      roundScores = scoring.roundScores;
      scoreUpdates = scoring.playerUpdates;
      gameStatusOverride = scoring.isGameComplete ? "game-complete" : "round-complete";
    }

    transaction.update(playerRef, {
      grid: cleared.grid,
      revealed: cleared.revealed,
    });
    transaction.update(gameRef, {
      lastTurnPlayerId: playerId,
      lastTurnAction,
      lastTurnActionAt: serverTimestamp(),
      ...resolution.gameUpdates,
      ...(clearedDiscard ? { discard: clearedDiscard } : {}),
      ...(gameStatusOverride ? { status: gameStatusOverride } : {}),
      ...(roundScores ? { roundScores } : {}),
    });

    if (scoreUpdates) {
      Object.entries(scoreUpdates).forEach(([targetPlayerId, updates]) => {
        const targetRef = doc(db, "games", gameId, "players", targetPlayerId);
        transaction.update(targetRef, updates);
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
    const players: Record<string, PlayerDoc> = {};
    await Promise.all(
      playerOrder.map(async (activePlayerId) => {
        const playerDocRef = doc(db, "games", gameId, "players", activePlayerId);
        const playerSnap = await transaction.get(playerDocRef);
        assertCondition(playerSnap.exists(), "Player not found.");
        players[activePlayerId] = playerSnap.data() as PlayerDoc;
      })
    );
    const allPlayersReady = playerOrder.every((activePlayerId) =>
      Boolean(players[activePlayerId].isReady)
    );
    assertCondition(allPlayersReady, "All players must be ready to start the next round.");

    const spikeMode = Boolean(game.spikeMode);
    const spikeItemCount = game.spikeItemCount ?? "low";
    const spikeRowClear = Boolean(game.spikeRowClear);
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
      ...(spikeMode ? { spikeItemCount, spikeRowClear } : {}),
      endingPlayerId: null,
      finalTurnRemainingIds: null,
      lastTurnPlayerId: null,
      lastTurnAction: null,
      skipNextTurnPlayerIds: [],
      roundScores: deleteField(),
    });

    playerOrder.forEach((targetPlayerId) => {
      const playerRef = doc(db, "games", gameId, "players", targetPlayerId);
      transaction.update(playerRef, {
        grid: playerGrids.get(targetPlayerId) ?? [],
        revealed: Array.from({ length: 12 }, () => false),
        pendingDraw: null,
        pendingDrawSource: null,
        isReady: false,
        roundScore: 0,
      });
    });
  });
};

export const readyForNextRound = async (gameId: string, playerId: string) => {
  const gameRef = doc(db, "games", gameId);
  const playerRef = doc(db, "games", gameId, "players", playerId);

  await runTransaction(db, async (transaction) => {
    const gameSnap = await transaction.get(gameRef);
    assertCondition(gameSnap.exists(), "Game not found.");
    const game = gameSnap.data() as GameDoc;
    assertCondition(game.status === "round-complete", "Round is not complete yet.");

    const playerSnap = await transaction.get(playerRef);
    assertCondition(playerSnap.exists(), "Player not found.");

    transaction.update(playerRef, { isReady: true });
  });
};
