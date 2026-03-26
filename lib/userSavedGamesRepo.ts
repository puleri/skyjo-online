import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  type FirestoreError,
  type FieldValue,
  type Unsubscribe,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";

export type SavedGamePayload = {
  gameId: string;
  partyId: string | null;
  playerIds: string[];
  playerNames: string[];
  status: "playing" | "round-complete";
  createdAt: FieldValue;
  updatedAt: FieldValue;
};

export type SavedGameRecord = {
  gameId: string;
  partyId: string | null;
  playerIds: string[];
  playerNames: string[];
  status: string;
};

export async function upsertSavedGameForUsers(userIds: string[], payload: SavedGamePayload) {
  const uniqueUserIds = Array.from(
    new Set(userIds.map((uid) => uid.trim()).filter((uid) => Boolean(uid))),
  );
  if (!payload.gameId.trim() || uniqueUserIds.length === 0) {
    return;
  }

  const batch = writeBatch(db);
  uniqueUserIds.forEach((uid) => {
    batch.set(doc(db, "users", uid, "savedGames", payload.gameId), payload, {
      merge: true,
    });
  });

  await batch.commit();
}

export async function deleteSavedGameForUser(uid: string, gameId: string) {
  const trimmedUid = uid.trim();
  const trimmedGameId = gameId.trim();
  if (!trimmedUid || !trimmedGameId) {
    return;
  }
  await deleteDoc(doc(db, "users", trimmedUid, "savedGames", trimmedGameId));
}

export function subscribeToSavedGames(
  uid: string,
  onNext: (savedGames: SavedGameRecord[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, "users", uid, "savedGames"), orderBy("updatedAt", "desc")),
    (snapshot) => {
      const savedGames = snapshot.docs
        .map((savedGameDoc) => {
          const data = savedGameDoc.data() as Record<string, unknown>;
          const gameId = typeof data.gameId === "string" ? data.gameId : savedGameDoc.id;
          if (!gameId.trim()) {
            return null;
          }
          return {
            gameId,
            partyId: typeof data.partyId === "string" ? data.partyId : null,
            playerIds: Array.isArray(data.playerIds)
              ? data.playerIds.filter((entry): entry is string => typeof entry === "string")
              : [],
            playerNames: Array.isArray(data.playerNames)
              ? data.playerNames.filter((entry): entry is string => typeof entry === "string")
              : [],
            status: typeof data.status === "string" ? data.status : "playing",
          };
        })
        .filter((entry): entry is SavedGameRecord => Boolean(entry));

      onNext(savedGames);
    },
    onError,
  );
}
