"use client";

import { FormEvent, useEffect, useState } from "react";

const storageKey = "skyjo:username";

export default function UsernameForm() {
  const [username, setUsername] = useState("");
  const [savedName, setSavedName] = useState<string | null>(null);

  useEffect(() => {
    const storedName = window.localStorage.getItem(storageKey);
    if (storedName) {
      setUsername(storedName);
      setSavedName(storedName);
    }
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      return;
    }

    window.localStorage.setItem(storageKey, trimmed);
    setSavedName(trimmed);
  };

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="username">Username</label>
      <input
        id="username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        placeholder="Skye"
      />
      <button type="submit" disabled={!username.trim()}>
        Save username
      </button>
      {savedName ? (
        <p className="notice">Saved as {savedName}.</p>
      ) : (
        <p>Pick a display name so other players can recognize you.</p>
      )}
    </form>
  );
}
