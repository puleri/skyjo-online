"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { readStoredUsername, useAnonymousAuth, usernameUpdatedEvent } from "../lib/auth";
import { acceptFriendLinkInvite } from "../lib/friendInvites";
import { db } from "../lib/firebase";
import { setPendingPartyJoin } from "../lib/pendingPartyJoin";
import LobbyScreen from "./LobbyScreen";
import UnauthenticatedHome from "./UnauthenticatedHome";

type HomeView = "unauthorized" | "authorized";
type HomeViewTransitionState = "idle" | "exiting" | "entering";

const HOME_VIEW_TRANSITION_MS = 260;
const FRIEND_LINK_PARAM = "friendInviteFrom";

export default function HomeGate() {
  const { uid, isAnonymousUser, isAuthStateReady, signInWithGoogleSso } = useAnonymousAuth();
  const [storedUsername, setStoredUsername] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<HomeView>("unauthorized");
  const [transitionState, setTransitionState] = useState<HomeViewTransitionState>("idle");
  const [friendLinkInviterUid, setFriendLinkInviterUid] = useState<string | null>(null);
  const [friendLinkInviterName, setFriendLinkInviterName] = useState<string>("");
  const [isFriendLinkDismissed, setIsFriendLinkDismissed] = useState(false);
  const [friendLinkStatus, setFriendLinkStatus] = useState<string | null>(null);
  const [isAcceptingFriendLink, setIsAcceptingFriendLink] = useState(false);
  const [isGoogleSsoPending, setIsGoogleSsoPending] = useState(false);
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

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const joinPartyId = searchParams.get("joinPartyId");
    const inviterUid = searchParams.get(FRIEND_LINK_PARAM);
    if (joinPartyId) {
      setPendingPartyJoin(joinPartyId);
    }
    setFriendLinkInviterUid(inviterUid?.trim() || null);
  }, []);

  useEffect(() => {
    if (friendLinkInviterUid) {
      setIsFriendLinkDismissed(false);
    }
  }, [friendLinkInviterUid]);

  useEffect(() => {
    if (!friendLinkInviterUid) {
      setFriendLinkInviterName("");
      return;
    }

    let isMounted = true;
    void getDoc(doc(db, "users", friendLinkInviterUid))
      .then((snapshot) => {
        if (!isMounted) {
          return;
        }

        const inviterData = snapshot.data() as Record<string, unknown> | undefined;
        const resolvedName =
          typeof inviterData?.displayName === "string" && inviterData.displayName.trim()
            ? inviterData.displayName.trim()
            : `Player ${friendLinkInviterUid.slice(0, 6)}`;
        setFriendLinkInviterName(resolvedName);
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        setFriendLinkInviterName(`Player ${friendLinkInviterUid.slice(0, 6)}`);
      });

    return () => {
      isMounted = false;
    };
  }, [friendLinkInviterUid]);

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

  const clearFriendLink = () => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.delete(FRIEND_LINK_PARAM);
    const nextSearch = searchParams.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
    setFriendLinkInviterUid(null);
  };

  const onCloseFriendLinkCard = () => {
    setIsFriendLinkDismissed(true);
    setFriendLinkStatus(null);
    clearFriendLink();
  };

  const onAcceptFriendFromLink = async () => {
    if (!uid || !friendLinkInviterUid || isAcceptingFriendLink) {
      return;
    }

    if (uid === friendLinkInviterUid) {
      setFriendLinkStatus("You cannot add yourself as a friend.");
      return;
    }

    setIsAcceptingFriendLink(true);
    setFriendLinkStatus(null);
    try {
      await acceptFriendLinkInvite(friendLinkInviterUid, uid);
      setFriendLinkStatus("Friend added!");
      clearFriendLink();
    } catch (error) {
      setFriendLinkStatus(error instanceof Error ? error.message : "Unable to add friend right now.");
    } finally {
      setIsAcceptingFriendLink(false);
    }
  };

  const onClickFriendLinkGoogleSso = async () => {
    if (isGoogleSsoPending) {
      return;
    }

    setIsGoogleSsoPending(true);
    try {
      await signInWithGoogleSso();
    } finally {
      setIsGoogleSsoPending(false);
    }
  };

  const shouldShowFriendLinkCard = Boolean(friendLinkInviterUid && !isFriendLinkDismissed);
  const inviterName = friendLinkInviterName || "A player";
  const friendInviteMessage = `${inviterName} wants to be your friend.`;

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
      {shouldShowFriendLinkCard ? (
        <aside className="friend-link-card" role="status" aria-live="polite">
          <p className="friend-link-card__title">{friendInviteMessage}</p>
          {uid && !isAnonymousUser ? (
            <button
              type="button"
              className="form-button-full-width form-card-font"
              onClick={() => {
                void onAcceptFriendFromLink();
              }}
              disabled={isAcceptingFriendLink}
            >
              {isAcceptingFriendLink ? "Adding friend…" : "Accept friend invitation"}
            </button>
          ) : null}
          {!uid ? (
            <button
              type="button"
              className={`form-button-full-width form-card-font ${isGoogleSsoPending ? "is-pending" : ""}`}
              onClick={() => {
                void onClickFriendLinkGoogleSso();
              }}
              disabled={isGoogleSsoPending}
            >
              {isGoogleSsoPending ? "Signing in…" : "Sign in with Google to add friend"}
            </button>
          ) : null}
          {uid && isAnonymousUser ? (
            <p className="notice">{`${inviterName} wants to be your friend. Sign in with SSO to add them.`}</p>
          ) : null}
          {friendLinkStatus ? <p className="notice">{friendLinkStatus}</p> : null}
          <button type="button" className="unauth-back-button" onClick={onCloseFriendLinkCard}>
            Close
          </button>
        </aside>
      ) : null}
    </div>
  );
}
