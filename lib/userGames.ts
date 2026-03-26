import { serverTimestamp, type FieldValue } from "firebase/firestore";

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
