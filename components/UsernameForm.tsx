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
      <div className="label-input-grid">
        <label className="form-card-font" htmlFor="username">Name</label>
        <input
          id="username"
          value={username}
          className="form-card-font remaining-grid"
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Skye"
        />

      </div>
      <button className="form-button-full-width form-card-font" type="submit" disabled={!username.trim()}>
       Save Name
      </button>
      {savedName ? (
        <p className="notice">Saved as {savedName}.</p>
      ) : (
        <p>Pick a display name so other players can recognize you.</p>
      )}
    </form>
  );
}
