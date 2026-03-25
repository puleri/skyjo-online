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
  acceptPartyInvite,
  declineFriendInvite,
  declinePartyInvite,
  inviteFriendToCurrentLobby as inviteFriendToCurrentLobbyAction,
  normalizeSocialUser,
  sendFriendInviteByIdentifier,
  subscribeToFriendProfiles,
  toPendingPartyInvite,
  type SocialFriendInvite,
  type SocialPartyInvite,
  type SocialUser,
} from "./socialPanel";

type SocialPanelInvites = {
  friend: SocialFriendInvite[];
  party: SocialPartyInvite[];
};

type SocialPanelData = {
  invites: SocialPanelInvites;
  friends: SocialUser[];
  online: SocialUser[];
  loading: boolean;
  error: string | null;
  sendFriendInvite: (targetIdentifier: string) => Promise<void>;
  acceptFriendInvite: (inviteId: string) => Promise<void>;
  declineFriendInvite: (inviteId: string) => Promise<void>;
  acceptPartyInvite: (inviteId: string) => Promise<void>;
  declinePartyInvite: (inviteId: string) => Promise<void>;
  inviteFriendToCurrentLobby: (friendUid: string, partyId: string) => Promise<void>;
};

export function useSocialPanel(): SocialPanelData {
  const { uid, displayName, profileDisplayName } = useAnonymousAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [friendInvites, setFriendInvites] = useState<SocialFriendInvite[]>([]);
  const [partyInvites, setPartyInvites] = useState<SocialPartyInvite[]>([]);
  const [friends, setFriends] = useState<SocialUser[]>([]);

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

    const partyInvitesQuery = query(
      collection(db, "partyInvites"),
      where("inviteeId", "==", uid),
      where("status", "==", "pending"),
    );

    const userRef = doc(db, "users", uid);
    let friendProfilesUnsubscribe: (() => void) | null = null;

    const handleError = (snapshotError: FirestoreError) => {
      setError(snapshotError.message);
      setLoading(false);
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

    const unsubscribePartyInvites = onSnapshot(
      partyInvitesQuery,
      (snapshot) => {
        setPartyInvites(
          snapshot.docs
            .map((inviteDoc) => toPendingPartyInvite(inviteDoc.id, inviteDoc.data() as Record<string, unknown>))
            .filter((invite): invite is SocialPartyInvite => Boolean(invite)),
        );
        setLoading(false);
      },
      handleError,
    );

    const unsubscribeProfile = onSnapshot(
      userRef,
      (snapshot) => {
        const userData = snapshot.data() as Record<string, unknown> | undefined;
        const friendUids = Array.isArray(userData?.friends)
          ? userData.friends.filter((friendUid): friendUid is string => typeof friendUid === "string")
          : [];

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

    return () => {
      unsubscribeFriendInvites();
      unsubscribePartyInvites();
      unsubscribeProfile();
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
