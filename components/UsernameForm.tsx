"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  readStoredUsername,
  useAnonymousAuth,
  usernameStorageKey,
  usernameUpdatedEvent,
} from "../lib/auth";
import { useUserProfile } from "../lib/useUserProfile";

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
  const {
    profile,
    loading: isProfileLoading,
    error: profileError,
    updateProfile,
  } = useUserProfile();

  const isSignedIn = Boolean(uid);
  const isGoogleSignedIn = isSignedIn && !isAnonymousUser;
  const shouldShowAnonymousForm = isSignedIn && authMode === "anonymous";
  const firstName = displayName?.trim().split(/\s+/)[0] ?? "there";

  useEffect(() => {
    const storedName = readStoredUsername();
    if (storedName) {
      setUsername(storedName);
      setSavedName(storedName);
    }
  }, []);

  useEffect(() => {
    if (isSignedIn && !isAnonymousUser) {
      const nextName = profile?.displayName?.trim() || displayName?.trim() || "";
      setUsername(nextName);
      setSavedName(nextName || null);
    }
  }, [displayName, isAnonymousUser, isSignedIn, profile?.displayName]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      return;
    }

    if (isSignedIn && !isAnonymousUser) {
      await updateProfile({ displayName: trimmed });
      setSavedName(trimmed);
      return;
    }

    window.localStorage.setItem(usernameStorageKey, trimmed);
    window.dispatchEvent(new Event(usernameUpdatedEvent));
    setSavedName(trimmed);
  };

  if (isGoogleSignedIn) {
    return (
      <form onSubmit={handleSubmit} className="form-card">
        <h3 className="signin-eyebrow-text">Signed in with Google</h3>
        <p>{`Hello, ${firstName}!`}</p>
        <p className="notice">{email ?? "No email available"}</p>
        <div className="label-input-grid">
          <label className="form-card-font" htmlFor="profile-name">
            Profile name
          </label>
          <input
            id="profile-name"
            value={username}
            className="form-card-font remaining-grid"
            onChange={(event) => setUsername(event.target.value)}
            placeholder={displayName ?? "Skye"}
            disabled={isProfileLoading}
          />
        </div>
        <button
          className="form-button-full-width form-card-font"
          type="submit"
          disabled={!username.trim() || isProfileLoading}
        >
          Save Profile Name
        </button>
        {savedName ? (
          <p className="notice">Profile saved as {savedName}.</p>
        ) : (
          <p>Choose the name other players should see in lobbies and games.</p>
        )}
        {profileError ? <p className="notice">Profile error: {profileError}</p> : null}
        {authError ? <p className="notice">Auth error: {authError}</p> : null}
      </form>
    );
  }

  if (!shouldShowAnonymousForm) {
    return (
      <div className="form-card">
        <h3 className="signin-eyebrow-text">Sign In to get started</h3>
        <p>Choose how you want to sign in before creating or joining a lobby.</p>
        <div className="row">
          <button
            className="form-button-full-width form-card-font mb-10"
            type="button"
            
            onClick={() => void signInAsAnonymous()}
          >
            Continue without signing in
          </button>
          <button
            className="form-button-full-width form-card-font"
            type="button"
            onClick={() => void signInWithGoogleSso()}
          >
            Sign in with Google
          </button>

        </div>
        {profileError ? <p className="notice">Profile error: {profileError}</p> : null}
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
        className="form-button-full-width form-card-font mt-20"
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
