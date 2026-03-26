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
import { parseSavedGameListItem, type SavedGameListItem } from "./userGames";

export type SavedGamePayload = {
  gameId: string;
  partyId: string | null;
  playerIds: string[];
  playerNames: string[];
  status: "playing" | "round-complete";
  createdAt: FieldValue;
  updatedAt: FieldValue;
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
  onNext: (savedGames: SavedGameListItem[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, "users", uid, "savedGames"), orderBy("updatedAt", "desc")),
    (snapshot) => {
      const savedGames = snapshot.docs
        .map((savedGameDoc) => parseSavedGameListItem(savedGameDoc.data(), { docId: savedGameDoc.id }))
        .filter((entry): entry is SavedGameListItem => Boolean(entry));

      onNext(savedGames);
    },
    onError,
  );
}
