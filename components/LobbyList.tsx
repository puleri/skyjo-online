"use client";

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

type Lobby = {
  id: string;
  name: string;
  status: string;
  players: number;
};

export default function LobbyList() {
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [error, setError] = useState<string | null>(null);
  const firebaseReady = isFirebaseConfigured;

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
        <p>
          Missing keys:{" "}
          {missingFirebaseConfig.length
            ? missingFirebaseConfig.join(", ")
            : "Unknown (restart the dev server)."}
        </p>
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
