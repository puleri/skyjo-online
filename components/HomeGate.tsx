"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { readStoredUsername, useAnonymousAuth, usernameUpdatedEvent } from "../lib/auth";
import LobbyScreen from "./LobbyScreen";
import UnauthenticatedHome from "./UnauthenticatedHome";

type HomeView = "unauthorized" | "authorized";
type HomeViewTransitionState = "idle" | "exiting" | "entering";

const HOME_VIEW_TRANSITION_MS = 260;

export default function HomeGate() {
  const { uid, isAnonymousUser, isAuthStateReady } = useAnonymousAuth();
  const [storedUsername, setStoredUsername] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<HomeView>("unauthorized");
  const [transitionState, setTransitionState] = useState<HomeViewTransitionState>("idle");
  const hasBootstrappedViewRef = useRef(false);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!isAuthStateReady) {
      return;
    }

    const nextView: HomeView = isReadyForLobby ? "authorized" : "unauthorized";

    if (!hasBootstrappedViewRef.current) {
      hasBootstrappedViewRef.current = true;
      setActiveView(nextView);
      setTransitionState("idle");
      return;
    }

    if (nextView === activeView) {
      return;
    }

    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }

    setTransitionState("exiting");
    transitionTimeoutRef.current = setTimeout(() => {
      setActiveView(nextView);
      setTransitionState("entering");

      transitionTimeoutRef.current = setTimeout(() => {
        setTransitionState("idle");
        transitionTimeoutRef.current = null;
      }, HOME_VIEW_TRANSITION_MS);
    }, HOME_VIEW_TRANSITION_MS);
  }, [activeView, isAuthStateReady, isReadyForLobby]);

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={`home-view-transition home-view-transition--${transitionState}`}>
      {activeView === "authorized" ? <LobbyScreen /> : <UnauthenticatedHome />}
    </div>
  );
}
