"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAnonymousAuth } from "../lib/auth";

const storageKey = "skyjo:username";

export default function UsernameForm() {
  const [username, setUsername] = useState("");
  const [savedName, setSavedName] = useState<string | null>(null);
  const {
    uid,
    email,
    displayName,
    isAnonymousUser,
    error: authError,
    authMode,
    signInAsAnonymous,
    signInWithGoogleSso,
    goBackToSignInMethods,
  } = useAnonymousAuth();

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

  const isSignedIn = Boolean(uid);
  const isGoogleSignedIn = isSignedIn && !isAnonymousUser;
  const shouldShowAnonymousForm = isSignedIn && authMode === "anonymous";

  if (isGoogleSignedIn) {
    return (
      <div className="form-card">
        <h3 className="charcoal-eyebrow-text">Signed in with Google</h3>
        <p>{displayName ?? "Google user"}</p>
        <p className="notice">{email ?? "No email available"}</p>
      </div>
    );
  }

  if (!shouldShowAnonymousForm) {
    return (
      <div className="form-card">
        <h3 className="charcoal-eyebrow-text">Sign In to get started</h3>
        <p>Choose how you want to sign in before creating or joining a lobby.</p>
        <button
          className="form-button-full-width form-card-font mb-10"
          type="button"
          onClick={() => void signInAsAnonymous()}
        >
          Anon auth
        </button>
        <button
          className="form-button-full-width form-card-font"
          type="button"
          onClick={() => void signInWithGoogleSso()}
        >
          Sign in with Google
        </button>
        {authError ? <p className="notice">Auth error: {authError}</p> : null}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="form-card">
      <div className="label-input-grid">
        <label className="form-card-font" htmlFor="username">
          Name
        </label>
        <input
          id="username"
          value={username}
          className="form-card-font remaining-grid"
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Skye"
        />
      </div>
      <button
        className="form-button-full-width form-card-font"
        type="submit"
        disabled={!username.trim()}
      >
        Save Name
      </button>
      <button
        className="form-button-full-width form-card-font"
        type="button"
        onClick={() => void goBackToSignInMethods()}
      >
        Back to sign in methods
      </button>
      {savedName ? (
        <p className="notice">Saved as {savedName}.</p>
      ) : (
        <p>Pick a display name so other players can recognize you.</p>
      )}
      {authError ? <p className="notice">Auth error: {authError}</p> : null}
    </form>
  );
}
