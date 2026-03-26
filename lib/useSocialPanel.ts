"use client";

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type FirestoreError,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAnonymousAuth } from "./auth";
import { db, isFirebaseConfigured } from "./firebase";
import {
  acceptFriendInvite,
  declineFriendInvite,
  inviteFriendToCurrentLobby as inviteFriendToCurrentLobbyAction,
  normalizeSocialUser,
  sendFriendInviteByIdentifier,
  subscribeToFriendProfiles,
  type SocialFriendInvite,
  type SocialUser,
} from "./socialPanel";
import {
  acceptPartyInvite,
  declinePartyInvite,
  subscribeToPendingPartyInvites,
  type SocialPartyInvite,
} from "./partyInvites";
import { subscribeToSavedGames, type SavedGameRecord } from "./userSavedGamesRepo";

type SocialPanelInvites = {
  friend: SocialFriendInvite[];
  party: SocialPartyInvite[];
};

type SocialPanelData = {
  invites: SocialPanelInvites;
  friends: SocialUser[];
  online: SocialUser[];
  yourGames: Array<{
    gameId: string;
    partyId: string | null;
    playerIds: string[];
    playerNames: string[];
    updatedAt: number | null;
  }>;
  loading: boolean;
  error: string | null;
  sendFriendInvite: (targetIdentifier: string) => Promise<void>;
  acceptFriendInvite: (inviteId: string) => Promise<void>;
  declineFriendInvite: (inviteId: string) => Promise<void>;
  acceptPartyInvite: (inviteId: string) => Promise<void>;
  declinePartyInvite: (inviteId: string) => Promise<void>;
  inviteFriendToCurrentLobby: (friendUid: string, partyId: string) => Promise<void>;
};

function parseLegacySavedGames(userData: Record<string, unknown> | undefined): SavedGameRecord[] {
  const rawSavedGames =
    userData?.savedGames && typeof userData.savedGames === "object"
      ? (userData.savedGames as Record<string, unknown>)
      : {};

  return Object.values(rawSavedGames)
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as Record<string, unknown>;
      const gameId = typeof candidate.gameId === "string" ? candidate.gameId : "";
      if (!gameId.trim()) {
        return null;
      }
      return {
        gameId,
        partyId: typeof candidate.partyId === "string" ? candidate.partyId : null,
        playerIds: Array.isArray(candidate.playerIds)
          ? candidate.playerIds.filter((id): id is string => typeof id === "string")
          : [],
        playerNames: Array.isArray(candidate.playerNames)
          ? candidate.playerNames.filter((name): name is string => typeof name === "string")
          : [],
        status: typeof candidate.status === "string" ? candidate.status : "playing",
        updatedAt: null,
      };
    })
    .filter((entry): entry is SavedGameRecord => Boolean(entry));
}

function mergeSavedGames(
  subcollectionSavedGames: SavedGameRecord[],
  legacySavedGames: SavedGameRecord[],
): SocialPanelData["yourGames"] {
  const deduped = new Map<string, SavedGameRecord>();
  legacySavedGames.forEach((entry) => {
    deduped.set(entry.gameId, entry);
  });
  subcollectionSavedGames.forEach((entry) => {
    deduped.set(entry.gameId, entry);
  });

  return Array.from(deduped.values())
    .filter((entry) => entry.status !== "game-complete")
    .map(({ status: _status, ...entry }) => entry);
}

export function useSocialPanel(): SocialPanelData {
  const { uid, displayName, profileDisplayName } = useAnonymousAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [friendInvites, setFriendInvites] = useState<SocialFriendInvite[]>([]);
  const [partyInvites, setPartyInvites] = useState<SocialPartyInvite[]>([]);
  const [friends, setFriends] = useState<SocialUser[]>([]);
  const [yourGames, setYourGames] = useState<SocialPanelData["yourGames"]>([]);

  const playerDisplayName = useMemo(() => {
    const trimmedProfileName = profileDisplayName?.trim();
    if (trimmedProfileName) {
      return trimmedProfileName;
    }

    const trimmedDisplayName = displayName?.trim();
    return trimmedDisplayName || "Anonymous player";
  }, [displayName, profileDisplayName]);

  useEffect(() => {
    if (!isFirebaseConfigured || !uid) {
      setFriendInvites([]);
      setPartyInvites([]);
      setFriends([]);
      setYourGames([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const friendInvitesQuery = query(
      collection(db, "friendInvites"),
      where("toUserId", "==", uid),
      where("status", "==", "pending"),
    );

    const userRef = doc(db, "users", uid);
    let friendProfilesUnsubscribe: (() => void) | null = null;
    let latestLegacySavedGames: SavedGameRecord[] = [];
    let latestSubcollectionSavedGames: SavedGameRecord[] = [];

    const handleError = (snapshotError: FirestoreError) => {
      setError(snapshotError.message);
      setLoading(false);
    };

    const syncSavedGames = () => {
      setYourGames(
        mergeSavedGames(latestSubcollectionSavedGames, latestLegacySavedGames),
      );
    };

    const unsubscribeFriendInvites = onSnapshot(
      friendInvitesQuery,
      (snapshot) => {
        setFriendInvites(
          snapshot.docs.map((inviteDoc) => {
            const invite = inviteDoc.data() as Record<string, unknown>;
            return {
              id: inviteDoc.id,
              fromUserId: typeof invite.fromUserId === "string" ? invite.fromUserId : "",
              toUserId: typeof invite.toUserId === "string" ? invite.toUserId : "",
              status: typeof invite.status === "string" ? invite.status : "pending",
            };
          }),
        );
        setLoading(false);
      },
      handleError,
    );

    const unsubscribePartyInvites = subscribeToPendingPartyInvites({
      db,
      uid,
      onNext: (nextInvites) => {
        setPartyInvites(nextInvites);
        setLoading(false);
      },
      onError: (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      },
    });

    const unsubscribeProfile = onSnapshot(
      userRef,
      (snapshot) => {
        const userData = snapshot.data() as Record<string, unknown> | undefined;
        const friendUids = Array.isArray(userData?.friends)
          ? userData.friends.filter((friendUid): friendUid is string => typeof friendUid === "string")
          : [];
        latestLegacySavedGames = parseLegacySavedGames(userData);
        syncSavedGames();

        if (friendProfilesUnsubscribe) {
          friendProfilesUnsubscribe();
          friendProfilesUnsubscribe = null;
        }

        friendProfilesUnsubscribe = subscribeToFriendProfiles({
          db,
          friendUids,
          onNext: (profiles) => {
            setFriends(profiles);
            setLoading(false);
          },
          onError: (friendProfileError) => {
            setError(friendProfileError.message);
            setLoading(false);
          },
        });
      },
      handleError,
    );
    const unsubscribeSavedGames = subscribeToSavedGames(
      uid,
      (savedGames) => {
        latestSubcollectionSavedGames = savedGames;
        syncSavedGames();
      },
      handleError,
    );

    return () => {
      unsubscribeFriendInvites();
      unsubscribePartyInvites();
      unsubscribeProfile();
      unsubscribeSavedGames();
      if (friendProfilesUnsubscribe) {
        friendProfilesUnsubscribe();
      }
    };
  }, [uid]);

  const online = useMemo(() => friends.filter((friend) => Boolean(friend.activeGameId)), [friends]);

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Unable to complete this action.";
      setError(message);
      throw actionError;
    }
  }, []);

  const sendFriendInviteHandler = useCallback(
    async (targetIdentifier: string) => {
      if (!uid) {
        throw new Error("Sign in to send friend invites.");
      }
      await runAction(() => sendFriendInviteByIdentifier(db, uid, targetIdentifier));
    },
    [runAction, uid],
  );

  const acceptFriendInviteHandler = useCallback(
    async (inviteId: string) => {
      if (!uid) {
        throw new Error("Sign in to accept friend invites.");
      }
      await runAction(() => acceptFriendInvite(inviteId, uid));
    },
    [runAction, uid],
  );

  const declineFriendInviteHandler = useCallback(
    async (inviteId: string) => {
      if (!uid) {
        throw new Error("Sign in to decline friend invites.");
      }
      await runAction(() => declineFriendInvite(inviteId, uid));
    },
    [runAction, uid],
  );

  const acceptPartyInviteHandler = useCallback(
    async (inviteId: string) => {
      if (!uid) {
        throw new Error("Sign in to accept party invites.");
      }
      await runAction(() =>
        acceptPartyInvite({ db, inviteId, currentUserId: uid, playerDisplayName }),
      );
    },
    [playerDisplayName, runAction, uid],
  );

  const declinePartyInviteHandler = useCallback(
    async (inviteId: string) => {
      if (!uid) {
        throw new Error("Sign in to decline party invites.");
      }
      await runAction(() => declinePartyInvite({ db, inviteId, currentUserId: uid }));
    },
    [runAction, uid],
  );

  const inviteFriendToCurrentLobbyHandler = useCallback(
    async (friendUid: string, partyId: string) => {
      if (!uid) {
        throw new Error("Sign in to invite friends.");
      }
      await runAction(() =>
        inviteFriendToCurrentLobbyAction({
          db,
          hostUid: uid,
          hostDisplayName: playerDisplayName,
          friendUid,
          partyId,
        }),
      );
    },
    [playerDisplayName, runAction, uid],
  );

  return {
    invites: {
      friend: friendInvites,
      party: partyInvites,
    },
    friends,
    online,
    yourGames,
    loading,
    error,
    sendFriendInvite: sendFriendInviteHandler,
    acceptFriendInvite: acceptFriendInviteHandler,
    declineFriendInvite: declineFriendInviteHandler,
    acceptPartyInvite: acceptPartyInviteHandler,
    declinePartyInvite: declinePartyInviteHandler,
    inviteFriendToCurrentLobby: inviteFriendToCurrentLobbyHandler,
  };
}

export const mapUserProfileToSocialUser = normalizeSocialUser;
