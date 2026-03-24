"use client";

import { useEffect, useMemo, useState } from "react";
import { readStoredUsername, useAnonymousAuth, usernameUpdatedEvent } from "../lib/auth";
import LobbyScreen from "./LobbyScreen";
import UnauthenticatedHome from "./UnauthenticatedHome";

export default function HomeGate() {
  const { uid, isAnonymousUser } = useAnonymousAuth();
  const [storedUsername, setStoredUsername] = useState<string | null>(null);

  useEffect(() => {
    const refreshStoredUsername = () => {
      setStoredUsername(readStoredUsername());
    };

    refreshStoredUsername();
    window.addEventListener(usernameUpdatedEvent, refreshStoredUsername);
    window.addEventListener("storage", refreshStoredUsername);

    return () => {
      window.removeEventListener(usernameUpdatedEvent, refreshStoredUsername);
      window.removeEventListener("storage", refreshStoredUsername);
    };
  }, []);

  const isReadyForLobby = useMemo(() => {
    if (!uid) {
      return false;
    }

    if (!isAnonymousUser) {
      return true;
    }

    return Boolean(storedUsername?.trim());
  }, [isAnonymousUser, storedUsername, uid]);

  if (!isReadyForLobby) {
    return <UnauthenticatedHome />;
  }

  return <LobbyScreen />;
}
