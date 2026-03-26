import { Timestamp, serverTimestamp, type FieldValue } from "firebase/firestore";

export type SavedGameStatus = "playing" | "round-complete" | "game-complete" | string;

export type SavedGameListItem = {
  gameId: string;
  partyId: string | null;
  playerIds: string[];
  playerNames: string[];
  status: SavedGameStatus;
  updatedAt: number | null;
};

export type StoredUserGame = {
  gameId: string;
  partyId: string | null;
  playerIds: string[];
  playerNames: string[];
  status: "playing" | "round-complete";
  createdAt: FieldValue;
  updatedAt: FieldValue;
};

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => Boolean(entry));
}

function logDiscardedSavedGame(reason: string, context: { docId?: string; data: unknown }) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  const { docId, data } = context;
  console.warn("[saved-games] Discarded malformed saved game record", {
    reason,
    docId,
    data,
  });
}

export function parseSavedGameListItem(
  rawData: unknown,
  options?: { docId?: string },
): SavedGameListItem | null {
  if (!rawData || typeof rawData !== "object") {
    logDiscardedSavedGame("payload is not an object", { docId: options?.docId, data: rawData });
    return null;
  }

  const data = rawData as Record<string, unknown>;
  const gameIdCandidate = typeof data.gameId === "string" ? data.gameId.trim() : "";
  const fallbackGameId = options?.docId?.trim() ?? "";
  const gameId = gameIdCandidate || fallbackGameId;

  if (!gameId) {
    logDiscardedSavedGame("missing gameId and docId fallback", {
      docId: options?.docId,
      data: rawData,
    });
    return null;
  }

  return {
    gameId,
    partyId: typeof data.partyId === "string" && data.partyId.trim() ? data.partyId : null,
    playerIds: sanitizeStringList(data.playerIds),
    playerNames: sanitizeStringList(data.playerNames),
    status: typeof data.status === "string" && data.status.trim() ? data.status : "playing",
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : null,
  };
}

export function buildStoredUserGame(params: {
  gameId: string;
  partyId: string | null;
  playerIds: string[];
  playerNames: string[];
}): StoredUserGame {
  return {
    gameId: params.gameId,
    partyId: params.partyId,
    playerIds: params.playerIds,
    playerNames: params.playerNames,
    status: "playing",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}
