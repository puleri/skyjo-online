"use client";

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type FirestoreError,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnonymousAuth } from "./auth";
import { db, isFirebaseConfigured } from "./firebase";
import {
  acceptFriendInvite,
  declineFriendInvite,
  inviteFriendToCurrentLobby as inviteFriendToCurrentLobbyAction,
  loadFriendProfilesSnapshot,
  normalizeSocialUser,
  sendFriendInviteByIdentifier,
  subscribeToHotFriendProfiles,
  type SocialFriendInvite,
  type SocialUser,
} from "./socialPanel";
import {
  acceptPartyInvite,
  declinePartyInvite,
  subscribeToPendingPartyInvites,
  type SocialPartyInvite,
} from "./partyInvites";
import { subscribeToSavedGames } from "./userSavedGamesRepo";
import { parseSavedGameListItem, type SavedGameListItem } from "./userGames";
import {
  getFriendListCache,
  getPendingInvitesCache,
  getSavedGamesSummaryCache,
  setFriendListCache,
  setPendingInvitesCache,
  setSavedGamesSummaryCache,
} from "./socialPanelCache";

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

const FRIEND_LIST_REVALIDATION_MS = 15 * 60 * 1000;
const HOT_FRIEND_REALTIME_LIMIT = 12;

function areFriendIdsEqual(first: string[], second: string[]): boolean {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((uid, index) => uid === second[index]);
}

function createFriendIdsKey(friendUids: string[]): string {
  return friendUids.join("\u0001");
}

function isFriendListCacheFresh(entry: FriendListCacheEntry | undefined): entry is FriendListCacheEntry {
  if (!entry) {
    return false;
  }

  return [...activeFriendUids, ...nonActiveFriendUids].slice(0, HOT_FRIEND_REALTIME_LIMIT);
}

function parseLegacySavedGames(userData: Record<string, unknown> | undefined): SavedGameListItem[] {
  const rawSavedGames =
    userData?.savedGames && typeof userData.savedGames === "object"
      ? (userData.savedGames as Record<string, unknown>)
      : {};

  return Object.entries(rawSavedGames)
    .map(([savedGameId, entry]) => parseSavedGameListItem(entry, { docId: savedGameId }))
    .filter((entry): entry is SavedGameListItem => Boolean(entry));
}


function mergeSavedGames(
  subcollectionSavedGames: SavedGameListItem[],
  legacySavedGames: SavedGameListItem[],
): SocialPanelData["yourGames"] {
  const deduped = new Map<string, SavedGameListItem>();
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
  const previousFriendIdsKeyRef = useRef<string | null>(null);
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
    previousFriendIdsKeyRef.current = null;

    const cachedFriendList = getFriendListCache(uid);
    const cachedInvites = getPendingInvitesCache(uid);
    const cachedSavedGames = getSavedGamesSummaryCache(uid);

    const friendInvitesQuery = query(
      collection(db, "friendInvites"),
      where("toUserId", "==", uid),
      where("status", "==", "pending"),
    );

    const userRef = doc(db, "users", uid);
    let hotFriendProfilesUnsubscribe: (() => void) | null = null;
    let revalidationIntervalId: ReturnType<typeof setInterval> | null = null;
    let currentFriendUids: string[] = [];
    let currentFriendInvites: SocialFriendInvite[] = cachedInvites.entry?.friend ?? [];
    let currentPartyInvites: SocialPartyInvite[] = cachedInvites.entry?.party ?? [];
    let latestLegacySavedGames: SavedGameListItem[] = [];
    let latestSubcollectionSavedGames: SavedGameListItem[] = [];

    if (cachedFriendList.entry) {
      setFriends(cachedFriendList.entry.friends);
    }

    if (cachedInvites.entry) {
      setFriendInvites(cachedInvites.entry.friend);
      setPartyInvites(cachedInvites.entry.party);
    }

    if (cachedSavedGames.entry) {
      latestSubcollectionSavedGames = cachedSavedGames.entry.entries;
    }

    if (cachedFriendList.entry || cachedInvites.entry || cachedSavedGames.entry) {
      setLoading(false);
    }

    const handleError = (snapshotError: FirestoreError) => {
      setError(snapshotError.message);
      setLoading(false);
    };

    const syncSavedGames = () => {
      const mergedGames = mergeSavedGames(latestSubcollectionSavedGames, latestLegacySavedGames);
      setYourGames(mergedGames);
      setSavedGamesSummaryCache(uid, { entries: latestSubcollectionSavedGames });
    };

    const unsubscribeFriendInvites = onSnapshot(
      friendInvitesQuery,
      (snapshot) => {
        const nextFriendInvites = snapshot.docs.map((inviteDoc) => {
          const invite = inviteDoc.data() as Record<string, unknown>;
          return {
            id: inviteDoc.id,
            fromUserId: typeof invite.fromUserId === "string" ? invite.fromUserId : "",
            toUserId: typeof invite.toUserId === "string" ? invite.toUserId : "",
            status: typeof invite.status === "string" ? invite.status : "pending",
          };
        });
        currentFriendInvites = nextFriendInvites;
        setFriendInvites(nextFriendInvites);
        setPendingInvitesCache(uid, {
          friend: nextFriendInvites,
          party: currentPartyInvites,
        });
        setLoading(false);
      },
      handleError,
    );

    const unsubscribePartyInvites = subscribeToPendingPartyInvites({
      db,
      uid,
      onNext: (nextInvites) => {
        currentPartyInvites = nextInvites;
        setPartyInvites(nextInvites);
        setPendingInvitesCache(uid, {
          friend: currentFriendInvites,
          party: nextInvites,
        });
        setLoading(false);
      },
      onError: (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      },
    });

    const stopHotFriendProfiles = () => {
      if (hotFriendProfilesUnsubscribe) {
        hotFriendProfilesUnsubscribe();
        hotFriendProfilesUnsubscribe = null;
      }
    };

    const upsertFriendProfiles = (incomingProfiles: SocialUser[]) => {
      setFriends((previousProfiles) => {
        const mergedProfilesByUid = new Map(previousProfiles.map((profile) => [profile.uid, profile]));
        incomingProfiles.forEach((profile) => {
          mergedProfilesByUid.set(profile.uid, profile);
        });

        return currentFriendUids
          .map((friendUid) => mergedProfilesByUid.get(friendUid))
          .filter((profile): profile is SocialUser => Boolean(profile));
      });
    };

    const revalidateAllFriendProfiles = async (friendUids: string[]) => {
      if (!friendUids.length) {
        setFriends([]);
        setFriendListCache(uid, {
          friendUids: [],
          friends: [],
        });
        stopHotFriendProfiles();
        setLoading(false);
        return;
      }

      try {
        const profiles = await loadFriendProfilesSnapshot({ db, friendUids });
        setFriends(profiles);
        setFriendListCache(uid, {
          friendUids,
          friends: profiles,
        });

        const hotFriendUids = selectHotFriendUids(profiles);
        stopHotFriendProfiles();
        hotFriendProfilesUnsubscribe = subscribeToHotFriendProfiles({
          db,
          friendUids: hotFriendUids,
          onNext: (hotProfiles) => {
            upsertFriendProfiles(hotProfiles);
            setFriends((latestProfiles) => {
              setFriendListCache(uid, {
                friendUids,
                friends: latestProfiles,
              });
              return latestProfiles;
            });
          },
          onError: (friendProfileError) => {
            setError(friendProfileError.message);
            setLoading(false);
          },
        });
        setLoading(false);
      } catch (friendProfileError) {
        const message = friendProfileError instanceof Error ? friendProfileError.message : "Unable to load friend profiles.";
        setError(message);
        setLoading(false);
      }
    };

    const unsubscribeProfile = onSnapshot(
      userRef,
      (snapshot) => {
        const userData = snapshot.data() as Record<string, unknown> | undefined;
        const friendUids = Array.isArray(userData?.friends)
          ? userData.friends.filter((friendUid): friendUid is string => typeof friendUid === "string")
          : [];
        const friendIdsKey = createFriendIdsKey(friendUids);
        const friendIdsChanged = previousFriendIdsKeyRef.current !== friendIdsKey;
        previousFriendIdsKeyRef.current = friendIdsKey;
        const latestCachedFriendList = friendListCache.get(uid);
        const cachedFriendIdsMatch =
          Boolean(latestCachedFriendList) &&
          createFriendIdsKey(latestCachedFriendList.friendUids) === friendIdsKey;
        const shouldUseCachedFriendList =
          isFriendListCacheFresh(latestCachedFriendList) &&
          areFriendIdsEqual(latestCachedFriendList.friendUids, friendUids);
        const shouldRevalidateFriendProfiles =
          cachedFriendIdsMatch && !isFriendListCacheFresh(latestCachedFriendList);
        latestLegacySavedGames = parseLegacySavedGames(userData);
        syncSavedGames();

        if (friendProfilesUnsubscribe && (friendIdsChanged || shouldRevalidateFriendProfiles)) {
          friendProfilesUnsubscribe();
          friendProfilesUnsubscribe = null;
        }

        if (shouldUseCachedFriendList) {
          const cachedFriendEntry = latestCachedFriendEntry;
          if (!cachedFriendEntry) {
            void revalidateAllFriendProfiles(friendUids);
            return;
          }
          setFriends(cachedFriendEntry.friends);
          const hotFriendUids = selectHotFriendUids(cachedFriendEntry.friends);
          stopHotFriendProfiles();
          hotFriendProfilesUnsubscribe = subscribeToHotFriendProfiles({
            db,
            friendUids: hotFriendUids,
            onNext: (hotProfiles) => {
              upsertFriendProfiles(hotProfiles);
            },
            onError: (friendProfileError) => {
              setError(friendProfileError.message);
              setLoading(false);
            },
          });
          if (!latestCachedFriendList.isFresh) {
            void revalidateAllFriendProfiles(friendUids);
          }
          revalidationIntervalId = setInterval(() => {
            void revalidateAllFriendProfiles(friendUids);
          }, FRIEND_LIST_REVALIDATION_MS);
          setLoading(false);
          return;
        }

        if (!friendUids.length) {
          setFriends([]);
          friendListCache.set(uid, {
            fetchedAt: Date.now(),
            friendUids: [],
            friends: [],
          });
          setLoading(false);
          return;
        }

        if (friendProfilesUnsubscribe && !friendIdsChanged && !shouldRevalidateFriendProfiles) {
          setLoading(false);
          return;
        }

        friendProfilesUnsubscribe = subscribeToFriendProfiles({
          db,
          friendUids,
          onNext: (profiles) => {
            setFriends(profiles);
            friendListCache.set(uid, {
              fetchedAt: Date.now(),
              friendUids,
              friends: profiles,
            });
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
      if (hotFriendProfilesUnsubscribe) {
        hotFriendProfilesUnsubscribe();
      }
      if (revalidationIntervalId) {
        clearInterval(revalidationIntervalId);
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
