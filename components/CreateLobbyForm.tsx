"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { FormEvent, useState } from "react";
import { db, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

export default function CreateLobbyForm() {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firebaseReady = isFirebaseConfigured;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firebaseReady || !name.trim()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await addDoc(collection(db, "lobbies"), {
        name: name.trim(),
        createdAt: serverTimestamp(),
        status: "open",
        players: 0,
      });
      setName("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!firebaseReady) {
    return (
      <div className="notice">
        <strong>Missing Firebase configuration.</strong>
        <p>
          Add values to <code>.env.local</code> (see <code>.env.local.example</code>)
          before creating lobbies.
        </p>
        <p>
          Missing keys:{" "}
          {missingFirebaseConfig.length
            ? missingFirebaseConfig.join(", ")
            : "Unknown (restart the dev server)."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="lobby-name">Lobby name</label>
      <input
        id="lobby-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Friday Night Skyjo"
      />
      <button type="submit" disabled={isSubmitting || !name.trim()}>
        {isSubmitting ? "Creating..." : "Create lobby"}
      </button>
      {error ? <p className="notice">{error}</p> : null}
    </form>
  );
}
