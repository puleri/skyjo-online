import { deleteField, doc, runTransaction } from "firebase/firestore";
import { db } from "./firebase";
import { createSkyjoDeck, shuffleDeck } from "./game/deck";

export type TurnPhase = "choose-draw" | "resolve-draw" | "choose-swap" | "resolve";

type GameDoc = {
  activePlayerOrder: string[];
  currentPlayerId: string;
  deck: number[];
  discard: number[];
  hostId?: string | null;
  roundNumber?: number;
  turnPhase: TurnPhase;
  endingPlayerId?: string | null;
  finalTurnRemainingIds?: string[] | null;
  selectedDiscardPlayerId?: string | null;
  status?: string;
  roundScores?: Record<string, number>;
  lastTurnPlayerId?: string | null;
  lastTurnAction?: string | null;
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
  const allRevealed = columnIndices.every((columnIndex) => revealed[columnIndex]);
  if (!allRevealed) {
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

const clearMatchedColumns = (grid: Array<number | null>, revealed: boolean[]) => {
  let nextGrid = [...grid];
  let nextRevealed = [...revealed];
  for (let column = 0; column < columns; column += 1) {
    const columnIndices = getColumnIndices(column);
    const values = columnIndices.map((columnIndex) => nextGrid[columnIndex]);
    const hasNull = values.some((value) => value === null || value === undefined);
    if (hasNull) {
      continue;
    }
    const allRevealed = columnIndices.every((columnIndex) => nextRevealed[columnIndex]);
    if (!allRevealed) {
      continue;
    }
    const [first, ...rest] = values;
    const isMatch = rest.every((value) => value === first);
    if (!isMatch) {
      continue;
    }
    columnIndices.forEach((columnIndex) => {
      nextGrid[columnIndex] = null;
      nextRevealed[columnIndex] = true;
    });
  }
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
  let refreshedDeck: number[] | null = null;
  if (game.deck.length === 0) {
    refreshedDeck = shuffleDeck(createSkyjoDeck());
    const lastDiscard = game.discard[game.discard.length - 1];
    if (typeof lastDiscard === "number") {
      const discardIndex = refreshedDeck.indexOf(lastDiscard);
      if (discardIndex !== -1) {
        refreshedDeck.splice(discardIndex, 1);
      }
    }
  }

  return {
    gameUpdates: {
      currentPlayerId: nextPlayerId,
      endingPlayerId,
      finalTurnRemainingIds,
      turnPhase: "choose-draw",
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
  endingPlayerId: string | null
) => {
  const roundScores: Record<string, number> = {};
  const scoresByPlayer = activeOrder.map((playerId) => {
    const player = players[playerId];
    const revealed = player.revealed.map(() => true);
    const cleared = clearMatchedColumns(player.grid, revealed);
    const score = calculateScore(cleared.grid);
    roundScores[playerId] = score;
    return { playerId, score, cleared };
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
  const totalScores: number[] = [];
  activeOrder.forEach((playerId, index) => {
    const cleared = scoresByPlayer[index].cleared;
    const previousTotal = players[playerId].totalScore ?? 0;
    const totalScore = previousTotal + roundScores[playerId];
    totalScores.push(totalScore);
    playerUpdates[playerId] = {
      grid: cleared.grid,
      revealed: cleared.revealed,
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
    assertCondition(targetIndex >= 0 && targetIndex < player.grid.length, "Invalid index.");

    const discard = [...game.discard];
    const drawnCard = discard.pop();
    assertCondition(typeof drawnCard === "number", "Discard pile is empty.");
    const drawn = drawnCard as number;

    const grid = [...player.grid];
    const revealed = [...player.revealed];
    const replacedCard = grid[targetIndex];
    assertCondition(replacedCard !== null && replacedCard !== undefined, "Slot is empty.");

    grid[targetIndex] = drawn;
    revealed[targetIndex] = true;
    discard.push(replacedCard as number);

    const cleared = clearColumnIfMatched(grid, revealed, targetIndex);

    const updatedPlayer: PlayerDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
    };

    const lastTurnAction = "took the discard pile card and swapped a card.";
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
        resolution.endingPlayerId
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
    assertCondition(typeof drawnCard === "number", "Deck is empty.");
    const drawn = drawnCard as number;

    transaction.update(playerRef, { pendingDraw: drawn, pendingDrawSource: "deck" });
    transaction.update(gameRef, {
      deck,
      turnPhase: "resolve-draw",
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
    assertCondition(typeof player.pendingDraw === "number", "No pending draw to keep.");
    assertCondition(targetIndex >= 0 && targetIndex < player.grid.length, "Invalid index.");

    const grid = [...player.grid];
    const revealed = [...player.revealed];
    const replacedCard = grid[targetIndex];
    assertCondition(replacedCard !== null && replacedCard !== undefined, "Slot is empty.");

    grid[targetIndex] = player.pendingDraw as number;
    revealed[targetIndex] = true;

    const discard = [...game.discard, replacedCard as number];
    const cleared = clearColumnIfMatched(grid, revealed, targetIndex);

    const updatedPlayer: PlayerDoc = {
      ...player,
      grid: cleared.grid,
      revealed: cleared.revealed,
    };

    const lastTurnAction = "drew from the deck and swapped a card.";
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
        resolution.endingPlayerId
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

    const lastTurnAction = "discarded the drawn card and revealed a card.";
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
        resolution.endingPlayerId
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

    const shuffledDeck = shuffleDeck(createSkyjoDeck());
    const playerGrids = new Map<string, number[]>();

    playerOrder.forEach((targetPlayerId) => {
      const grid: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        const card = shuffledDeck.pop();
        assertCondition(typeof card === "number", "Not enough cards to deal the next round.");
        grid.push(card as number);
      }
      playerGrids.set(targetPlayerId, grid);
    });

    const discardCard = shuffledDeck.pop();
    assertCondition(typeof discardCard === "number", "Deck is empty after dealing.");
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
      endingPlayerId: null,
      finalTurnRemainingIds: null,
      lastTurnPlayerId: null,
      lastTurnAction: null,
      roundScores: deleteField(),
    });

    playerOrder.forEach((targetPlayerId) => {
      const playerRef = doc(db, "games", gameId, "players", targetPlayerId);
      transaction.update(playerRef, {
        grid: playerGrids.get(targetPlayerId) ?? [],
        revealed: Array.from({ length: 12 }, () => false),
        pendingDraw: null,
        pendingDrawSource: null,
        roundScore: 0,
      });
    });
  });
};
