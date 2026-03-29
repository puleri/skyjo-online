"use client";

import type { SocialPartyInvite } from "./partyInvites";
import type { SocialFriendInvite, SocialUser } from "./socialPanel";
import type { SavedGameListItem } from "./userGames";

export const SOCIAL_PANEL_CACHE_TTLS = {
  friendsMs: 10 * 60 * 1000,
  invitesMs: 10 * 60 * 1000,
  savedGamesMs: 30 * 60 * 1000,
} as const;

type CacheMeta = {
  fetchedAt: number;
};

export type FriendListCacheEntry = CacheMeta & {
  friendUids: string[];
  friends: SocialUser[];
};

export type PendingInvitesCacheEntry = CacheMeta & {
  friend: SocialFriendInvite[];
  party: SocialPartyInvite[];
};

export type SavedGamesSummaryCacheEntry = CacheMeta & {
  entries: SavedGameListItem[];
};

type SocialPanelUidCache = {
  friends?: FriendListCacheEntry;
  invites?: PendingInvitesCacheEntry;
  savedGames?: SavedGamesSummaryCacheEntry;
};

type SocialPanelCacheStore = Record<string, SocialPanelUidCache>;

const STORAGE_KEY = "misty:social-panel-cache:v1";

let memoryCache: SocialPanelCacheStore = {};
let initialized = false;

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadCacheStore(): SocialPanelCacheStore {
  if (!canUseLocalStorage()) {
    return memoryCache;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as SocialPanelCacheStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function ensureCacheReady() {
  if (initialized) {
    return;
  }

  memoryCache = loadCacheStore();
  initialized = true;
}

function persistCacheStore() {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryCache));
  } catch {
    // Ignore quota/privacy mode storage errors and continue with in-memory cache.
  }
}

function getUidCache(uid: string): SocialPanelUidCache {
  ensureCacheReady();
  if (!memoryCache[uid]) {
    memoryCache[uid] = {};
  }
  return memoryCache[uid];
}

function isFresh(fetchedAt: number, ttlMs: number) {
  return Date.now() - fetchedAt < ttlMs;
}

export function getFriendListCache(uid: string) {
  const entry = getUidCache(uid).friends;
  return {
    entry,
    isFresh: Boolean(entry && isFresh(entry.fetchedAt, SOCIAL_PANEL_CACHE_TTLS.friendsMs)),
  };
}

export function setFriendListCache(uid: string, entry: Omit<FriendListCacheEntry, "fetchedAt">) {
  const uidCache = getUidCache(uid);
  uidCache.friends = {
    ...entry,
    fetchedAt: Date.now(),
  };
  persistCacheStore();
}

export function getPendingInvitesCache(uid: string) {
  const entry = getUidCache(uid).invites;
  return {
    entry,
    isFresh: Boolean(entry && isFresh(entry.fetchedAt, SOCIAL_PANEL_CACHE_TTLS.invitesMs)),
  };
}

export function setPendingInvitesCache(uid: string, entry: Omit<PendingInvitesCacheEntry, "fetchedAt">) {
  const uidCache = getUidCache(uid);
  uidCache.invites = {
    ...entry,
    fetchedAt: Date.now(),
  };
  persistCacheStore();
}

export function getSavedGamesSummaryCache(uid: string) {
  const entry = getUidCache(uid).savedGames;
  return {
    entry,
    isFresh: Boolean(entry && isFresh(entry.fetchedAt, SOCIAL_PANEL_CACHE_TTLS.savedGamesMs)),
  };
}

export function setSavedGamesSummaryCache(
  uid: string,
  entry: Omit<SavedGamesSummaryCacheEntry, "fetchedAt">,
) {
  const uidCache = getUidCache(uid);
  uidCache.savedGames = {
    ...entry,
    fetchedAt: Date.now(),
  };
  persistCacheStore();
}
