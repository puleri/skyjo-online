export const DEFAULT_MATCH_BASE_XP = 50;
export const CLEARED_ROW_XP_MULTIPLIER = 5;
export const REWARD_UNLOCK_LEVEL_INTERVAL = 5;

// Level number -> cumulative XP required to be at that level.
export const LEVEL_XP_TABLE = [
  0, 100, 220, 360, 520, 700, 900, 1120, 1360, 1620, 1900, 2200, 2520, 2860,
  3220, 3600, 4000, 4420, 4860, 5320,
] as const;

const PLACEMENT_BAND_XP = {
  "first place": 120,
  "top 25%": 80,
  "top 50%": 50,
  "bottom 50%": 25,
  "last place": 25,
} as const;

export type PlacementBand = keyof typeof PLACEMENT_BAND_XP;

export type LevelProgress = {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number | null;
  xpIntoLevel: number;
  xpNeededForNextLevel: number;
  progressPercent: number;
};

export type StoredLevelProgress = {
  currentLevel: number;
  xpGainedTowardCurrentLevel: number;
  xpRequiredForCurrentLevel: number;
  xpRemainingToNextLevel: number;
  nextLevel: number;
  progressPercent: number;
};

export type NextLevelMeta = {
  currentLevel: number;
  nextLevel: number | null;
  currentLevelXp: number;
  nextLevelXp: number | null;
  xpRemaining: number;
  isMaxLevel: boolean;
};

export type EarnedXpBreakdown = {
  baseXp: number;
  placementXp: number;
  clearedRowXp: number;
  totalXp: number;
  placementBand: PlacementBand;
  playerCountMultiplier: number;
};

function clampNonNegative(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeLevel(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function getOverflowLevelXpRequirement(level: number) {
  const lastKnownIndex = LEVEL_XP_TABLE.length - 1;
  const lastKnownLevel = lastKnownIndex + 1;
  const lastKnownXp = LEVEL_XP_TABLE[lastKnownIndex];
  const finalIncrement =
    LEVEL_XP_TABLE[lastKnownIndex] - LEVEL_XP_TABLE[lastKnownIndex - 1];
  const extraLevels = Math.max(0, level - lastKnownLevel);
  return lastKnownXp + extraLevels * finalIncrement;
}

export function getXpRequiredForLevel(level: number) {
  const normalizedLevel = Math.max(1, Math.floor(level));
  const tableValue = LEVEL_XP_TABLE[normalizedLevel - 1];
  return tableValue ?? getOverflowLevelXpRequirement(normalizedLevel);
}

export function getXpRequiredForCurrentLevel(level: number) {
  const normalizedLevel = normalizeLevel(level);
  return (
    getXpRequiredForLevel(normalizedLevel + 1) -
    getXpRequiredForLevel(normalizedLevel)
  );
}

export function getLevelForXp(experience: number) {
  const safeExperience = clampNonNegative(experience);

  for (let index = LEVEL_XP_TABLE.length - 1; index >= 0; index -= 1) {
    if (safeExperience >= LEVEL_XP_TABLE[index]) {
      return index + 1;
    }
  }

  return 1;
}

export function getProgressWithinLevel(experience: number): LevelProgress {
  const safeExperience = clampNonNegative(experience);
  const level = getLevelForXp(safeExperience);
  const currentLevelXp = getXpRequiredForLevel(level);
  const nextLevel = level + 1;
  const nextLevelXp = getXpRequiredForLevel(nextLevel);
  const xpIntoLevel = safeExperience - currentLevelXp;
  const xpNeededForNextLevel = Math.max(0, nextLevelXp - currentLevelXp);
  const progressPercent =
    xpNeededForNextLevel === 0
      ? 100
      : Math.min(100, Math.max(0, (xpIntoLevel / xpNeededForNextLevel) * 100));

  return {
    level,
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel,
    xpNeededForNextLevel,
    progressPercent,
  };
}

export function getStoredLevelProgress(
  level: number,
  experience: number,
): StoredLevelProgress {
  let currentLevel = normalizeLevel(level);
  let xpGainedTowardCurrentLevel = clampNonNegative(experience);
  let xpRequiredForCurrentLevel = getXpRequiredForCurrentLevel(currentLevel);

  while (xpGainedTowardCurrentLevel >= xpRequiredForCurrentLevel) {
    xpGainedTowardCurrentLevel -= xpRequiredForCurrentLevel;
    currentLevel += 1;
    xpRequiredForCurrentLevel = getXpRequiredForCurrentLevel(currentLevel);
  }

  return {
    currentLevel,
    xpGainedTowardCurrentLevel,
    xpRequiredForCurrentLevel,
    xpRemainingToNextLevel: Math.max(
      0,
      xpRequiredForCurrentLevel - xpGainedTowardCurrentLevel,
    ),
    nextLevel: currentLevel + 1,
    progressPercent:
      xpRequiredForCurrentLevel === 0
        ? 100
        : Math.min(
            100,
            Math.max(
              0,
              (xpGainedTowardCurrentLevel / xpRequiredForCurrentLevel) * 100,
            ),
          ),
  };
}

export function applyEarnedExperience(
  level: number,
  experience: number,
  earnedExperience: number,
) {
  return getStoredLevelProgress(
    level,
    clampNonNegative(experience) + clampNonNegative(earnedExperience),
  );
}


export function getRewardUnlockIdForLevel(level: number) {
  const normalizedLevel = normalizeLevel(level);
  return `level-${normalizedLevel}-reward`;
}

export function getNewlyUnlockedRewardIds(
  previousLevel: number,
  currentLevel: number,
) {
  const normalizedPreviousLevel = normalizeLevel(previousLevel);
  const normalizedCurrentLevel = normalizeLevel(currentLevel);

  if (normalizedCurrentLevel <= normalizedPreviousLevel) {
    return [] as string[];
  }

  const unlockedRewards: string[] = [];
  for (
    let level = normalizedPreviousLevel + 1;
    level <= normalizedCurrentLevel;
    level += 1
  ) {
    if (level % REWARD_UNLOCK_LEVEL_INTERVAL === 0) {
      unlockedRewards.push(getRewardUnlockIdForLevel(level));
    }
  }

  return unlockedRewards;
}

export function getNextLevelMetadata(experience: number): NextLevelMeta {
  const progress = getProgressWithinLevel(experience);
  const nextLevel = progress.level + 1;
  const nextLevelXp = getXpRequiredForLevel(nextLevel);

  return {
    currentLevel: progress.level,
    nextLevel,
    currentLevelXp: progress.currentLevelXp,
    nextLevelXp,
    xpRemaining: Math.max(0, nextLevelXp - clampNonNegative(experience)),
    isMaxLevel: false,
  };
}

export function isNextLevelMultipleOfFive(value: number | NextLevelMeta) {
  const nextLevel = typeof value === "number" ? value : value.nextLevel;
  return typeof nextLevel === "number" && nextLevel % 5 === 0;
}

export function getPlayerCountMultiplier(playerCount: number) {
  const normalizedPlayerCount = Math.max(2, Math.floor(playerCount));
  return 1 + (normalizedPlayerCount - 2) * 0.12;
}

export function getPlacementPercentile(finalRank: number, lobbySize: number) {
  const normalizedLobbySize = Math.max(2, Math.floor(lobbySize));
  const normalizedRank = Math.min(
    normalizedLobbySize,
    Math.max(1, Math.floor(finalRank)),
  );
  if (normalizedLobbySize === 1) {
    return 1;
  }
  return (normalizedLobbySize - normalizedRank) / (normalizedLobbySize - 1);
}

/**
 * Maps a concrete placement into the reward band used for progression XP.
 *
 * Ordering matters:
 * - `first place` is checked before percentile buckets so the winner always gets
 *   the winner band even when the top-half bucket would also match.
 * - `last place` is checked before `bottom 50%` so the final finisher keeps its
 *   own explicit label instead of being swallowed by the generic lower-half band.
 *
 * Rounding strategy for percentile-style buckets:
 * - We compute the target slot count with `Math.ceil(playerCount * share)`.
 * - `Math.ceil` is intentionally generous: if a split lands between whole
 *   players, we round up so borderline finishes still feel rewarded.
 * - After that, `top 50%` means ranks `<= ceil(playerCount * 0.5)` and
 *   `top 25%` means ranks `<= ceil(playerCount * 0.25)`.
 *
 * Examples called out in product language so the rewards feel intentional:
 * - 3 players: `ceil(3 * 0.25) = 1`, so only 1st is in the top-quarter band;
 *   `ceil(3 * 0.5) = 2`, so 2nd still counts as top-half.
 * - 5 players: `ceil(5 * 0.25) = 2`, so 2nd is generously included in top 25%;
 *   `ceil(5 * 0.5) = 3`, so the middle finisher still counts as top-half.
 * - 7 players: `ceil(7 * 0.25) = 2`, so the top-quarter band stays selective at
 *   two players; `ceil(7 * 0.5) = 4`, so finishing 4th still lands in top-half.
 */
export function getPlacementBand(
  placement: number,
  playerCount: number,
): PlacementBand {
  const normalizedPlayerCount = Math.max(2, Math.floor(playerCount));
  const normalizedPlacement = Math.min(
    normalizedPlayerCount,
    Math.max(1, Math.floor(placement)),
  );

  if (normalizedPlacement === 1) {
    return "first place";
  }

  if (normalizedPlacement === normalizedPlayerCount) {
    return "last place";
  }

  const topQuarterCutoff = Math.ceil(normalizedPlayerCount * 0.25);
  if (normalizedPlacement <= topQuarterCutoff) {
    return "top 25%";
  }

  const topHalfCutoff = Math.ceil(normalizedPlayerCount * 0.5);
  if (normalizedPlacement <= topHalfCutoff) {
    return "top 50%";
  }

  return "bottom 50%";
}

export function getPlacementXp(finalRank: number, lobbySize: number) {
  const placementBand = getPlacementBand(finalRank, lobbySize);
  const playerCountMultiplier = getPlayerCountMultiplier(lobbySize);
  return Math.round(PLACEMENT_BAND_XP[placementBand] * playerCountMultiplier);
}

export function getClearedRowXp(pointsClearedFromRows: number) {
  return clampNonNegative(pointsClearedFromRows) * CLEARED_ROW_XP_MULTIPLIER;
}

export function getTotalEarnedXpBreakdown({
  baseXp = DEFAULT_MATCH_BASE_XP,
  finalRank,
  lobbySize,
  pointsClearedFromRows,
}: {
  baseXp?: number;
  finalRank: number;
  lobbySize: number;
  pointsClearedFromRows: number;
}): EarnedXpBreakdown {
  const placementBand = getPlacementBand(finalRank, lobbySize);
  const playerCountMultiplier = getPlayerCountMultiplier(lobbySize);
  const placementXp = Math.round(
    PLACEMENT_BAND_XP[placementBand] * playerCountMultiplier,
  );
  const clearedRowXp = getClearedRowXp(pointsClearedFromRows);
  const normalizedBaseXp = clampNonNegative(baseXp);

  return {
    baseXp: normalizedBaseXp,
    placementXp,
    clearedRowXp,
    totalXp: normalizedBaseXp + placementXp + clearedRowXp,
    placementBand,
    playerCountMultiplier,
  };
}
