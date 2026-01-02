"use client";

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";

const requiredEnv = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];

type Lobby = {
  id: string;
  name: string;
  status: string;
  players: number;
};

function useFirebaseReady() {
  return useMemo(() => requiredEnv.every((key) => process.env[key]), []);
}

export default function LobbyList() {
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [error, setError] = useState<string | null>(null);
  const firebaseReady = useFirebaseReady();

  useEffect(() => {
    if (!firebaseReady) {
      return;
    }

    const lobbyQuery = query(collection(db, "lobbies"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      lobbyQuery,
      (snapshot) => {
        const nextLobbies = snapshot.docs.map((doc) => ({
          id: doc.id,
          name: doc.data().name ?? "Untitled lobby",
          status: doc.data().status ?? "open",
          players: doc.data().players ?? 0,
        }));
        setLobbies(nextLobbies);
      },
      (err) => {
        setError(err.message);
      }
    );

    return () => unsubscribe();
  }, [firebaseReady]);

  if (!firebaseReady) {
    return (
      <div className="notice">
        <strong>Firestore is not connected yet.</strong>
        <p>Provide your Firebase environment variables to load live lobbies.</p>
      </div>
    );
  }

  if (error) {
    return <p className="notice">Firestore error: {error}</p>;
  }

  if (!lobbies.length) {
    return <p>No lobbies yet. Create one above to see real-time updates.</p>;
  }

  return (
    <ul>
      {lobbies.map((lobby) => (
        <li key={lobby.id}>
          <div>
            <strong>{lobby.name}</strong>
            <div>
              <small>Status: {lobby.status}</small>
            </div>
          </div>
          <small>{lobby.players} players</small>
        </li>
      ))}
    </ul>
  );
}
