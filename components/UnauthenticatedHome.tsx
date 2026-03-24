"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  readStoredUsername,
  useAnonymousAuth,
  usernameStorageKey,
  usernameUpdatedEvent,
} from "../lib/auth";
import { usePreferences } from "../lib/preferences";
import SnowfallLayer from "./SnowfallLayer";

type AuthEntryStep = "method-selection" | "anonymous-name";

export default function UnauthenticatedHome() {
  const { preferences } = usePreferences();
  const { snow: isSnowEnabled } = preferences;
  const [entryStep, setEntryStep] = useState<AuthEntryStep>("method-selection");
  const [username, setUsername] = useState("");
  const [savedName, setSavedName] = useState<string | null>(null);

  const { uid, error, signInAsAnonymous, signInWithGoogleSso } = useAnonymousAuth();

  useEffect(() => {
    const storedName = readStoredUsername();
    if (storedName) {
      setUsername(storedName);
      setSavedName(storedName);
    }
  }, []);

  const handleContinueWithoutSignIn = () => {
    setEntryStep("anonymous-name");
  };

  const handleAnonymousNameSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      return;
    }

    if (!uid) {
      await signInAsAnonymous();
    }

    window.localStorage.setItem(usernameStorageKey, trimmed);
    window.dispatchEvent(new Event(usernameUpdatedEvent));
    setSavedName(trimmed);
  };

  return (
    <main className="lobby-scene-wrapper">
      {isSnowEnabled ? <SnowfallLayer height={"180%"} /> : null}

      <div className="container">
        <div className="flex-space-between">
        </div>

        <section className="" style={{ maxWidth: 540, margin: "100px auto 0" }}>
          {entryStep === "method-selection" ? (
            <>
              <button
                className="form-button-full-width form-card-font mb-10"
                type="button"
                onClick={() => void signInWithGoogleSso()}
              >
                Sign in
              </button>
              <p className="form-card-font" style={{ textAlign: "center", margin: "0 0 10px" }}>
                or
              </p>
              <button
                className="form-button-full-width form-card-font"
                type="button"
                onClick={handleContinueWithoutSignIn}
              >
                Continue without signing in
              </button>
            </>
          ) : (
            <form onSubmit={handleAnonymousNameSave}>
              <p>To continue, create the name other players will see you as.</p>
              <div className="label-input-grid">
                <label className="form-card-font" htmlFor="unauth-home-username">
                  Name
                </label>
                <input
                  id="unauth-home-username"
                  value={username}
                  className="form-card-font remaining-grid"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Skye"
                />
              </div>
              <button
                className="form-button-full-width form-card-font mt-20"
                type="submit"
                disabled={!username.trim()}
              >
                Save
              </button>
              <button
                className="form-button-full-width form-card-font mt-20"
                type="button"
                onClick={() => setEntryStep("method-selection")}
              >
                Back
              </button>
              {savedName ? <p className="notice">Saved as {savedName}.</p> : null}
            </form>
          )}

          {error ? <p className="notice">Auth error: {error}</p> : null}
        </section>
      </div>
    </main>
  );
}
