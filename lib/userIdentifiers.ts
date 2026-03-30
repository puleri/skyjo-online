import {
  doc,
  serverTimestamp,
  type Firestore,
  type Transaction,
} from "firebase/firestore";

export type UserIdentifierKind = "uid" | "name" | "email";

type IdentifierValues = {
  uid: string;
  displayName: string | null;
  email: string | null;
};

export function normalizeIdentifierValue(value: string | null | undefined) {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return null;
  }

  return trimmedValue.toLowerCase();
}

export function createUserIdentifierDocId(kind: UserIdentifierKind, value: string) {
  const normalizedValue = normalizeIdentifierValue(value);
  if (!normalizedValue) {
    throw new Error(`Cannot create a user identifier key for empty ${kind} value.`);
  }

  return `${kind}:${normalizedValue}`;
}

function identifierDocRef(db: Firestore, kind: UserIdentifierKind, value: string) {
  const normalizedValue = normalizeIdentifierValue(value);
  if (!normalizedValue) {
    return null;
  }

  return doc(db, "userIdentifiers", `${kind}:${normalizedValue}`);
}

export function syncUserIdentifierDocsInTransaction(params: {
  db: Firestore;
  transaction: Transaction;
  previous: IdentifierValues;
  next: IdentifierValues;
}) {
  const { db, transaction, previous, next } = params;
  const currentUidRef = identifierDocRef(db, "uid", next.uid);
  if (currentUidRef) {
    transaction.set(currentUidRef, {
      uid: next.uid,
      kind: "uid",
      updatedAt: serverTimestamp(),
    });
  }

  const previousNameRef = previous.displayName ? identifierDocRef(db, "name", previous.displayName) : null;
  const nextNameRef = next.displayName ? identifierDocRef(db, "name", next.displayName) : null;
  if (previousNameRef && (!nextNameRef || previousNameRef.path !== nextNameRef.path)) {
    transaction.delete(previousNameRef);
  }
  if (nextNameRef) {
    transaction.set(nextNameRef, {
      uid: next.uid,
      kind: "name",
      updatedAt: serverTimestamp(),
    });
  }

  const previousEmailRef = previous.email ? identifierDocRef(db, "email", previous.email) : null;
  const nextEmailRef = next.email ? identifierDocRef(db, "email", next.email) : null;
  if (previousEmailRef && (!nextEmailRef || previousEmailRef.path !== nextEmailRef.path)) {
    transaction.delete(previousEmailRef);
  }
  if (nextEmailRef) {
    transaction.set(nextEmailRef, {
      uid: next.uid,
      kind: "email",
      updatedAt: serverTimestamp(),
    });
  }
}

export function profileIdentifierValueOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}
