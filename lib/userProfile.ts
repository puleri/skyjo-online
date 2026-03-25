import type { User } from "firebase/auth";
import type { Timestamp } from "firebase/firestore";
import { preferenceDefaults, type Preferences } from "./preferences";

export const USER_PROFILE_LAST_FIVE_GAMES_LIMIT = 5;

export type UserProfileTimestamp = Timestamp | Date | string | null;

export type UserProfileSettings = Preferences;

export type UserProfileGamePlacement = number;

export type UserProfileLastXpGainAnimation = {
  gameId: string;
  awardedXp: number;
  fromLevel: number;
  fromExperience: number;
  toLevel: number;
  toExperience: number;
  playedAt?: UserProfileTimestamp;
  dismissed?: boolean;
};

export type UserProfile = {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  friends: string[];
  activeGameId: string | null;
  presenceState: "online" | "in_game" | "offline";
  lastSeenAt: UserProfileTimestamp;
  lastFiveGames: UserProfileGamePlacement[];
  settingsPreferences: UserProfileSettings;
  level: number;
  experience: number;
  unlockedSpells: string[];
  rewardedGameIds?: string[];
  lastXpGainAnimation?: UserProfileLastXpGainAnimation | null;
  createdAt: UserProfileTimestamp;
  updatedAt: UserProfileTimestamp;
};

export type UserProfileAuthFields = Pick<User, "uid" | "displayName" | "email" | "photoURL">;

export type UserProfileUpdate = Partial<Omit<UserProfile, "settingsPreferences" | "lastFiveGames">> & {
  settingsPreferences?: Partial<UserProfileSettings>;
  lastFiveGames?: UserProfileGamePlacement[];
};

export function createDefaultUserSettings(): UserProfileSettings {
  return { ...preferenceDefaults };
}

export function clampLastFiveGames(
  entries: readonly UserProfileGamePlacement[]
): UserProfileGamePlacement[] {
  return entries.slice(-USER_PROFILE_LAST_FIVE_GAMES_LIMIT);
}

export function formatPlacementLabel(placement: UserProfileGamePlacement): string {
  const remainderTen = placement % 10;
  const remainderHundred = placement % 100;

  if (remainderTen === 1 && remainderHundred !== 11) {
    return `${placement}st`;
  }

  if (remainderTen === 2 && remainderHundred !== 12) {
    return `${placement}nd`;
  }

  if (remainderTen === 3 && remainderHundred !== 13) {
    return `${placement}rd`;
  }

  return `${placement}th`;
}

export function defaultUserProfile(authUser: UserProfileAuthFields): UserProfile {
  return {
    uid: authUser.uid,
    displayName: authUser.displayName,
    email: authUser.email,
    photoURL: authUser.photoURL,
    friends: [],
    activeGameId: null,
    presenceState: "offline",
    lastSeenAt: null,
    lastFiveGames: [],
    settingsPreferences: createDefaultUserSettings(),
    level: 1,
    experience: 0,
    unlockedSpells: [],
    rewardedGameIds: [],
    lastXpGainAnimation: null,
    createdAt: null,
    updatedAt: null,
  };
}

export function mergeUserProfile(
  current: UserProfile,
  updates: UserProfileUpdate
): UserProfile {
  return {
    ...current,
    ...updates,
    friends: [...(updates.friends ?? current.friends)],
    activeGameId:
      updates.activeGameId === undefined ? current.activeGameId : updates.activeGameId,
    presenceState:
      updates.presenceState === undefined ? current.presenceState : updates.presenceState,
    lastSeenAt: updates.lastSeenAt === undefined ? current.lastSeenAt : updates.lastSeenAt,
    unlockedSpells: [...(updates.unlockedSpells ?? current.unlockedSpells)],
    rewardedGameIds: [...(updates.rewardedGameIds ?? current.rewardedGameIds ?? [])],
    lastXpGainAnimation:
      updates.lastXpGainAnimation === undefined
        ? current.lastXpGainAnimation ?? null
        : updates.lastXpGainAnimation,
    lastFiveGames: clampLastFiveGames(updates.lastFiveGames ?? current.lastFiveGames),
    settingsPreferences: {
      ...createDefaultUserSettings(),
      ...current.settingsPreferences,
      ...updates.settingsPreferences,
    },
  };
}
