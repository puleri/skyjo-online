import {
  collection,
  documentId,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";

export function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export function subscribeToUsersByIdChunks(params: {
  db: Firestore;
  userIds: string[];
  onChunkSnapshot: (docs: QueryDocumentSnapshot<DocumentData>[], chunkUserIds: string[]) => void;
  onError: (error: Error) => void;
}) {
  const { db, userIds, onChunkSnapshot, onError } = params;

  if (!userIds.length) {
    return () => {};
  }

  const unsubscribers: Unsubscribe[] = [];

  chunkValues(userIds, 10).forEach((userIdChunk) => {
    const usersQuery = query(collection(db, "users"), where(documentId(), "in", userIdChunk));

    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        onChunkSnapshot(snapshot.docs, userIdChunk);
      },
      (error) => {
        onError(error);
      },
    );

    unsubscribers.push(unsubscribe);
  });

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}
