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
  type FriendListCacheEntry,
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

const FRIEND_PROFILE_STALE_MS = 15 * 60 * 1000;
const FRIEND_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const HOT_FRIEND_REALTIME_LIMIT = 12;

function createFriendIdsKey(friendUids: string[]): string {
  return friendUids.join("\u0001");
}

function isFriendListCacheFresh(entry: FriendListCacheEntry | undefined): entry is FriendListCacheEntry {
  if (!entry) {
    return false;
  }

  return Date.now() - entry.fetchedAt < FRIEND_PROFILE_STALE_MS;
}

function computeFriendUidDelta(previous: Set<string>, next: string[]) {
  const nextSet = new Set(next);
  const added = next.filter((uid) => !previous.has(uid));
  const unchanged = next.filter((uid) => previous.has(uid));
  const removed = Array.from(previous).filter((uid) => !nextSet.has(uid));
  return { added, removed, unchanged, nextSet };
}

function selectHotFriendUids(profiles: SocialUser[]): string[] {
  const activeFriendUids = profiles.filter((profile) => Boolean(profile.activeGameId)).map((profile) => profile.uid);
  const nonActiveFriendUids = profiles
    .filter((profile) => !profile.activeGameId)
    .map((profile) => profile.uid);

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
  const previousFriendUidSetRef = useRef<Set<string>>(new Set());
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
    previousFriendUidSetRef.current = new Set();

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
    let refreshIntervalId: ReturnType<typeof setInterval> | null = null;
    let currentHotFriendIdsKey = "";
    let currentFriendUids: string[] = cachedFriendList.entry?.friendUids ?? [];
    let currentHotFriendUids: string[] = [];
    const profileFetchedAtByUid = new Map<string, number>();
    let currentFriendInvites: SocialFriendInvite[] = cachedInvites.entry?.friend ?? [];
    let currentPartyInvites: SocialPartyInvite[] = cachedInvites.entry?.party ?? [];
    let latestLegacySavedGames: SavedGameListItem[] = [];
    let latestSubcollectionSavedGames: SavedGameListItem[] = [];

    if (cachedFriendList.entry) {
      const cachedFetchedAt = cachedFriendList.entry.fetchedAt;
      cachedFriendList.entry.friends.forEach((friend) => {
        profileFetchedAtByUid.set(friend.uid, cachedFetchedAt);
      });
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

    const stopHotFriendProfiles = () => {
      if (hotFriendProfilesUnsubscribe) {
        hotFriendProfilesUnsubscribe();
        hotFriendProfilesUnsubscribe = null;
      }
    };

    const stopRefreshInterval = () => {
      if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
      }
    };

    const syncSavedGames = () => {
      const mergedGames = mergeSavedGames(latestSubcollectionSavedGames, latestLegacySavedGames);
      setYourGames(mergedGames);
      setSavedGamesSummaryCache(uid, { entries: latestSubcollectionSavedGames });
    };

    const upsertFriendProfiles = (incomingProfiles: SocialUser[]) => {
      setFriends((previousProfiles) => {
        const mergedProfilesByUid = new Map(previousProfiles.map((profile) => [profile.uid, profile]));
        incomingProfiles.forEach((profile) => {
          mergedProfilesByUid.set(profile.uid, profile);
          profileFetchedAtByUid.set(profile.uid, Date.now());
        });

        const nextProfiles = currentFriendUids
          .map((friendUid) => mergedProfilesByUid.get(friendUid))
          .filter((profile): profile is SocialUser => Boolean(profile));

        refreshHotFriendSubscriptions(nextProfiles);
        setFriendListCache(uid, {
          friendUids: currentFriendUids,
          friends: nextProfiles,
        });

        return nextProfiles;
      });
    };

    const removeFriendProfiles = (removedFriendUids: string[]) => {
      if (!removedFriendUids.length) {
        return;
      }

      const removedSet = new Set(removedFriendUids);
      removedFriendUids.forEach((friendUid) => {
        profileFetchedAtByUid.delete(friendUid);
      });
      setFriends((previousProfiles) => {
        const nextProfiles = previousProfiles.filter((profile) => !removedSet.has(profile.uid));
        refreshHotFriendSubscriptions(nextProfiles);
        setFriendListCache(uid, {
          friendUids: currentFriendUids,
          friends: nextProfiles,
        });
        return nextProfiles;
      });
    };

    const refreshHotFriendSubscriptions = (profiles: SocialUser[]) => {
      const hotFriendUids = selectHotFriendUids(profiles);
      const hotFriendIdsKey = createFriendIdsKey(hotFriendUids);
      if (hotFriendIdsKey === currentHotFriendIdsKey) {
        return;
      }

      currentHotFriendIdsKey = hotFriendIdsKey;
      currentHotFriendUids = hotFriendUids;
      stopHotFriendProfiles();
      if (!hotFriendUids.length) {
        return;
      }
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
    };

    const fetchFriendProfilesDelta = async (friendUids: string[]) => {
      if (!friendUids.length) {
        return;
      }

      try {
        const profiles = await loadFriendProfilesSnapshot({ db, friendUids });
        upsertFriendProfiles(profiles);
        setLoading(false);
      } catch (friendProfileError) {
        const message =
          friendProfileError instanceof Error ? friendProfileError.message : "Unable to load friend profiles.";
        setError(message);
        setLoading(false);
      }
    };

    const applyFriendUids = (friendUids: string[]) => {
      currentFriendUids = friendUids;
      if (!friendUids.length) {
        stopHotFriendProfiles();
        currentHotFriendIdsKey = "";
        currentHotFriendUids = [];
        stopRefreshInterval();
        setFriends([]);
        setFriendListCache(uid, {
          friendUids: [],
          friends: [],
        });
        setLoading(false);
        return;
      }
    };

    const refreshFriendsInBackground = async () => {
      if (!currentFriendUids.length) {
        return;
      }

      const staleCutoff = Date.now() - FRIEND_PROFILE_STALE_MS;
      const prioritizedUids = Array.from(new Set([...currentHotFriendUids, ...currentFriendUids]));
      const staleOrHotUids = prioritizedUids.filter((friendUid) => {
        const fetchedAt = profileFetchedAtByUid.get(friendUid) ?? 0;
        return fetchedAt < staleCutoff || currentHotFriendUids.includes(friendUid);
      });

      await fetchFriendProfilesDelta(staleOrHotUids.slice(0, HOT_FRIEND_REALTIME_LIMIT));
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

    const unsubscribeProfile = onSnapshot(
      userRef,
      (snapshot) => {
        const userData = snapshot.data() as Record<string, unknown> | undefined;
        const friendUids = Array.isArray(userData?.friends)
          ? userData.friends.filter((friendUid): friendUid is string => typeof friendUid === "string")
          : [];

        const friendIdsKey = createFriendIdsKey(friendUids);
        const previousFriendUidSet = previousFriendUidSetRef.current;
        const { added, removed, unchanged, nextSet } = computeFriendUidDelta(previousFriendUidSet, friendUids);
        const friendIdsChanged = added.length > 0 || removed.length > 0 || unchanged.length !== friendUids.length;
        previousFriendUidSetRef.current = nextSet;

        const latestCachedFriendList = getFriendListCache(uid);
        const cachedFriendEntry = latestCachedFriendList.entry;
        const cachedFriendIdsMatch = cachedFriendEntry
          ? createFriendIdsKey(cachedFriendEntry.friendUids) === friendIdsKey
          : false;
        const shouldUseCachedFriendList =
          cachedFriendEntry
          ? cachedFriendIdsMatch && isFriendListCacheFresh(cachedFriendEntry)
          : false;

        latestLegacySavedGames = parseLegacySavedGames(userData);
        syncSavedGames();

        if (shouldUseCachedFriendList && cachedFriendEntry) {
          applyFriendUids(friendUids);
          setFriends(cachedFriendEntry.friends);
          refreshHotFriendSubscriptions(cachedFriendEntry.friends);
          cachedFriendEntry.friends.forEach((friend) => {
            profileFetchedAtByUid.set(friend.uid, cachedFriendEntry.fetchedAt);
          });

          setLoading(false);
        } else {
          applyFriendUids(friendUids);
        }

        if (friendIdsChanged) {
          removeFriendProfiles(removed);
          void fetchFriendProfilesDelta(added);
        }

        if (!friendIdsChanged && !shouldUseCachedFriendList) {
          const staleFriendUids = friendUids.filter((friendUid) => {
            const fetchedAt = profileFetchedAtByUid.get(friendUid) ?? 0;
            return Date.now() - fetchedAt >= FRIEND_PROFILE_STALE_MS;
          });
          void fetchFriendProfilesDelta(staleFriendUids.slice(0, HOT_FRIEND_REALTIME_LIMIT));
        }

        if (!refreshIntervalId && friendUids.length > 0) {
          refreshIntervalId = setInterval(() => {
            void refreshFriendsInBackground();
          }, FRIEND_REFRESH_INTERVAL_MS);
        }
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
      stopHotFriendProfiles();
      stopRefreshInterval();
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
      await runAction(() => acceptPartyInvite({ db, inviteId, currentUserId: uid, playerDisplayName }));
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
