import { deleteField, serverTimestamp, type FieldValue } from "firebase/firestore";

export type StoredUserGame = {
  gameId: string;
  partyId: string | null;
  playerIds: string[];
  playerNames: string[];
  status: "playing" | "round-complete";
  createdAt: FieldValue;
  updatedAt: FieldValue;
};

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

export function getUserGameStoragePath(gameId: string) {
  return `savedGames.${gameId}`;
}

export function buildRemoveStoredUserGameUpdate(gameId: string) {
  return {
    [getUserGameStoragePath(gameId)]: deleteField(),
    updatedAt: serverTimestamp(),
  };
}
