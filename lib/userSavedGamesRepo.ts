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

const SAVED_GAMES_REVALIDATION_MS = 60 * 60 * 1000;

type SavedGamesSubscriber = {
  onNext: (savedGames: SavedGameListItem[]) => void;
  onError?: (error: FirestoreError) => void;
};

type SavedGamesSubscriptionState = {
  lastSnapshotAt: number;
  latestSavedGames: SavedGameListItem[];
  subscribers: Set<SavedGamesSubscriber>;
  firestoreUnsubscribe: Unsubscribe | null;
  teardownTimer: ReturnType<typeof setTimeout> | null;
};

const savedGamesSubscriptions = new Map<string, SavedGamesSubscriptionState>();

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
  const trimmedUid = uid.trim();
  if (!trimmedUid) {
    onNext([]);
    return () => undefined;
  }

  const subscriber: SavedGamesSubscriber = {
    onNext,
    onError,
  };

  let state = savedGamesSubscriptions.get(trimmedUid);
  if (!state) {
    state = {
      lastSnapshotAt: 0,
      latestSavedGames: [],
      subscribers: new Set(),
      firestoreUnsubscribe: null,
      teardownTimer: null,
    };
    savedGamesSubscriptions.set(trimmedUid, state);
  }

  if (state.teardownTimer) {
    clearTimeout(state.teardownTimer);
    state.teardownTimer = null;
  }

  state.subscribers.add(subscriber);

  if (state.lastSnapshotAt > 0) {
    onNext(state.latestSavedGames);
  }

  if (!state.firestoreUnsubscribe) {
    state.firestoreUnsubscribe = onSnapshot(
      query(collection(db, "users", trimmedUid, "savedGames"), orderBy("updatedAt", "desc")),
      (snapshot) => {
        const savedGames = snapshot.docs
          .map((savedGameDoc) => parseSavedGameListItem(savedGameDoc.data(), { docId: savedGameDoc.id }))
          .filter((entry): entry is SavedGameListItem => Boolean(entry));

        const nextState = savedGamesSubscriptions.get(trimmedUid);
        if (!nextState) {
          return;
        }

        nextState.lastSnapshotAt = Date.now();
        nextState.latestSavedGames = savedGames;
        nextState.subscribers.forEach((activeSubscriber) => {
          activeSubscriber.onNext(savedGames);
        });
      },
      (snapshotError) => {
        const nextState = savedGamesSubscriptions.get(trimmedUid);
        if (!nextState) {
          return;
        }
        nextState.subscribers.forEach((activeSubscriber) => {
          activeSubscriber.onError?.(snapshotError);
        });
      },
    );
  }

  return () => {
    const nextState = savedGamesSubscriptions.get(trimmedUid);
    if (!nextState) {
      return;
    }

    nextState.subscribers.delete(subscriber);
    if (nextState.subscribers.size > 0 || nextState.teardownTimer) {
      return;
    }

    nextState.teardownTimer = setTimeout(() => {
      const stateAtTeardown = savedGamesSubscriptions.get(trimmedUid);
      if (!stateAtTeardown || stateAtTeardown.subscribers.size > 0) {
        return;
      }

      if (
        stateAtTeardown.firestoreUnsubscribe &&
        Date.now() - stateAtTeardown.lastSnapshotAt >= SAVED_GAMES_REVALIDATION_MS
      ) {
        stateAtTeardown.firestoreUnsubscribe();
        stateAtTeardown.firestoreUnsubscribe = null;
      }
      stateAtTeardown.teardownTimer = null;
    }, SAVED_GAMES_REVALIDATION_MS);
  };
}
