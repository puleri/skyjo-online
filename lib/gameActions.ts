import { doc, runTransaction } from "firebase/firestore";
import { db } from "./firebase";

export type TurnPhase = "choose-draw" | "resolve-draw" | "choose-swap" | "resolve";

type GameDoc = {
  activePlayerOrder: string[];
  currentPlayerId: string;
  deck: number[];
  discard: number[];
  turnPhase: TurnPhase;
  endingPlayerId?: string | null;
  finalTurnRemainingIds?: string[] | null;
  status?: string;
  roundScores?: Record<string, number>;
};

type PlayerDoc = {
  grid: Array<number | null>;
  revealed: boolean[];
  pendingDraw?: number | null;
  pendingDrawSource?: "deck" | "discard" | null;
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

const clearColumnIfMatched = (grid: Array<number | null>, revealed: boolean[], index: number) => {
  const columnIndices = getColumnIndices(index);
  const values = columnIndices.map((columnIndex) => grid[columnIndex]);
  const hasNull = values.some((value) => value === null || value === undefined);
  if (hasNull) {
    return { grid, revealed };
  }
  const [first, ...rest] = values;
  const isMatch = rest.every((value) => value === first);
  if (!isMatch) {
    return { grid, revealed };
  }
  const nextGrid = [...grid];
  const nextRevealed = [...revealed];
  columnIndices.forEach((columnIndex) => {
    nextGrid[columnIndex] = null;
    nextRevealed[columnIndex] = true;
  });
  return { grid: nextGrid, revealed: nextRevealed };
};

const allCardsRevealed = (revealed: boolean[]) => revealed.every(Boolean);

const calculateScore = (grid: Array<number | null>) =>
  grid.reduce<number>((total, value) => total + (value ?? 0), 0);

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
      },
      roundComplete,
      endingPlayerId,
      finalTurnRemainingIds: [],
    };
  }

  const nextPlayerId = getNextPlayerId(activeOrder, updatedPlayerId);

  return {
    gameUpdates: {
      currentPlayerId: nextPlayerId,
      endingPlayerId,
      finalTurnRemainingIds,
      turnPhase: "choose-draw",
    },
    roundComplete,
    endingPlayerId,
    finalTurnRemainingIds,
  };
};

const computeRoundScores = (
  activeOrder: string[],
  players: Record<string, PlayerDoc>,
  endingPlayerId: string | null
) => {
  const roundScores: Record<string, number> = {};
  const scoresByPlayer = activeOrder.map((playerId) => {
    const player = players[playerId];
    const score = calculateScore(player.grid);
    roundScores[playerId] = score;
    return { playerId, score };
  });
  const positiveScores = scoresByPlayer
    .map(({ score }) => score)
    .filter((score) => score > 0)
    .sort((a, b) => a - b);
  const lowestPositiveScore = positiveScores[0];
  if (endingPlayerId && typeof lowestPositiveScore === "number") {
    const endingScore = roundScores[endingPlayerId];
    if (endingScore > lowestPositiveScore) {
      roundScores[endingPlayerId] = endingScore * 2;
    }
  }

  const playerUpdates: Record<string, Partial<PlayerDoc>> = {};
  activeOrder.forEach((playerId) => {
    const previousTotal = players[playerId].totalScore ?? 0;
    playerUpdates[playerId] = {
      revealed: players[playerId].revealed.map(() => true),
      roundScore: roundScores[playerId],
      totalScore: previousTotal + roundScores[playerId],
    };
  });

  return { roundScores, playerUpdates };
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
    assertCondition(targetIndex >= 0 && targetIndex < player.grid.length, "Invalid index.");

    const discard = [...game.discard];
    const drawnCard = discard.pop();
    assertCondition(typeof drawnCard === "number", "Discard pile is empty.");

    const grid = [...player.grid];
    const revealed = [...player.revealed];
    const replacedCard = grid[targetIndex];
    assertCondition(replacedCard !== null && replacedCard !== undefined, "Slot is empty.");

    grid[targetIndex] = drawnCard;
    revealed[targetIndex] = true;
    discard.push(replacedCard as number);

    const cleared = clearColumnIfMatched(grid, revealed, targetIndex);

    const updatedPlayer: PlayerDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
    };

    const resolution = resolveTurn(game, playerId, updatedPlayer);

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: Record<string, Partial<PlayerDoc>> | null = null;

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
        resolution.endingPlayerId
      );
      roundScores = scoring.roundScores;
      scoreUpdates = scoring.playerUpdates;
    }

    transaction.update(playerRef, {
      grid: cleared.grid,
      revealed: cleared.revealed,
      pendingDraw: null,
      pendingDrawSource: null,
    });
    transaction.update(gameRef, {
      discard,
      ...resolution.gameUpdates,
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
    assertCondition(typeof drawnCard === "number", "Deck is empty.");

    transaction.update(playerRef, { pendingDraw: drawnCard, pendingDrawSource: "deck" });
    transaction.update(gameRef, { deck, turnPhase: "resolve-draw" });
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
    assertCondition(typeof player.pendingDraw === "number", "No pending draw to keep.");
    assertCondition(targetIndex >= 0 && targetIndex < player.grid.length, "Invalid index.");

    const grid = [...player.grid];
    const revealed = [...player.revealed];
    const replacedCard = grid[targetIndex];
    assertCondition(replacedCard !== null && replacedCard !== undefined, "Slot is empty.");

    grid[targetIndex] = player.pendingDraw;
    revealed[targetIndex] = true;

    const discard = [...game.discard, replacedCard as number];
    const cleared = clearColumnIfMatched(grid, revealed, targetIndex);

    const updatedPlayer: PlayerDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
    };

    const resolution = resolveTurn(game, playerId, updatedPlayer);

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: Record<string, Partial<PlayerDoc>> | null = null;

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
        resolution.endingPlayerId
      );
      roundScores = scoring.roundScores;
      scoreUpdates = scoring.playerUpdates;
    }

    transaction.update(playerRef, {
      grid: cleared.grid,
      revealed: cleared.revealed,
      pendingDraw: null,
      pendingDrawSource: null,
    });
    transaction.update(gameRef, {
      discard,
      ...resolution.gameUpdates,
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
    assertCondition(typeof player.pendingDraw === "number", "No pending draw to discard.");

    const discard = [...game.discard, player.pendingDraw];

    transaction.update(playerRef, { pendingDraw: null, pendingDrawSource: null });
    transaction.update(gameRef, { discard, turnPhase: "resolve" });
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
    assertCondition(targetIndex >= 0 && targetIndex < player.grid.length, "Invalid index.");
    assertCondition(!player.revealed[targetIndex], "Slot already revealed.");
    assertCondition(player.grid[targetIndex] !== null, "Slot is empty.");

    const revealed = [...player.revealed];
    revealed[targetIndex] = true;

    const cleared = clearColumnIfMatched([...player.grid], revealed, targetIndex);

    const updatedPlayer: PlayerDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
    };

    const resolution = resolveTurn(game, playerId, updatedPlayer);

    let roundScores: Record<string, number> | null = null;
    let scoreUpdates: Record<string, Partial<PlayerDoc>> | null = null;

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
        resolution.endingPlayerId
      );
      roundScores = scoring.roundScores;
      scoreUpdates = scoring.playerUpdates;
    }

    transaction.update(playerRef, {
      grid: cleared.grid,
      revealed: cleared.revealed,
    });
    transaction.update(gameRef, {
      ...resolution.gameUpdates,
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
