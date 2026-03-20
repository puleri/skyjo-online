import type { User } from "firebase/auth";
import type { Timestamp } from "firebase/firestore";
import { preferenceDefaults, type Preferences } from "./preferences";

export const USER_PROFILE_LAST_FIVE_GAMES_LIMIT = 5;

export type UserProfileTimestamp = Timestamp | Date | string | null;

export type UserProfileSettings = Preferences;

export type UserProfileGamePlacement = {
  gameId: string;
  placed: number;
  playerCount: number;
  finishedAt: UserProfileTimestamp;
};

export type UserProfile = {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  friends: string[];
  lastFiveGames: UserProfileGamePlacement[];
  settingsPreferences: UserProfileSettings;
  level: number;
  experience: number;
  unlockedSpells: string[];
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

export function defaultUserProfile(authUser: UserProfileAuthFields): UserProfile {
  return {
    uid: authUser.uid,
    displayName: authUser.displayName,
    email: authUser.email,
    photoURL: authUser.photoURL,
    friends: [],
    lastFiveGames: [],
    settingsPreferences: createDefaultUserSettings(),
    level: 1,
    experience: 0,
    unlockedSpells: [],
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
    unlockedSpells: [...(updates.unlockedSpells ?? current.unlockedSpells)],
    lastFiveGames: clampLastFiveGames(updates.lastFiveGames ?? current.lastFiveGames),
    settingsPreferences: {
      ...createDefaultUserSettings(),
      ...current.settingsPreferences,
      ...updates.settingsPreferences,
    },
  };
}
