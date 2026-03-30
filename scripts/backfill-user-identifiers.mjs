#!/usr/bin/env node
import process from "node:process";
import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

function normalizeIdentifierValue(value) {
  const trimmedValue = typeof value === "string" ? value.trim() : "";
  return trimmedValue ? trimmedValue.toLowerCase() : null;
}

function createDocId(kind, value) {
  const normalized = normalizeIdentifierValue(value);
  if (!normalized) {
    return null;
  }

  return `${kind}:${normalized}`;
}

const requiredEnvVars = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_APP_ID",
];

const missing = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missing.length > 0) {
  console.error(`Missing Firebase env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const app = initializeApp({
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  appId: process.env.FIREBASE_APP_ID,
});

const db = getFirestore(app);
const usersSnapshot = await getDocs(collection(db, "users"));

let batch = writeBatch(db);
let batchWrites = 0;
let totalWrites = 0;
const commitBatch = async () => {
  if (!batchWrites) {
    return;
  }

  await batch.commit();
  totalWrites += batchWrites;
  batch = writeBatch(db);
  batchWrites = 0;
};

for (const userDoc of usersSnapshot.docs) {
  const userData = userDoc.data();
  const uid = userDoc.id;

  const keys = [
    { kind: "uid", id: createDocId("uid", uid) },
    { kind: "name", id: createDocId("name", userData.displayName) },
    { kind: "email", id: createDocId("email", userData.email) },
  ].filter((entry) => Boolean(entry.id));

  for (const key of keys) {
    batch.set(doc(db, "userIdentifiers", key.id), {
      uid,
      kind: key.kind,
      updatedAt: serverTimestamp(),
    });
    batchWrites += 1;

    if (batchWrites >= 450) {
      await commitBatch();
    }
  }
}

await commitBatch();
console.log(`Backfill complete. Processed ${usersSnapshot.size} users with ${totalWrites} lookup writes.`);
