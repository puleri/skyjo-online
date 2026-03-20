export const DEFAULT_MATCH_BASE_XP = 50;
export const CLEARED_ROW_XP_MULTIPLIER = 5;

// Level number -> cumulative XP required to be at that level.
export const LEVEL_XP_TABLE = [
  0, 100, 220, 360, 520, 700, 900, 1120, 1360, 1620, 1900, 2200, 2520, 2860,
  3220, 3600, 4000, 4420, 4860, 5320,
] as const;

const PLACEMENT_BAND_XP = {
  top: 120,
  high: 80,
  mid: 50,
  low: 25,
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

export function getPlacementBand(percentile: number): PlacementBand {
  if (percentile >= 0.8) {
    return "top";
  }
  if (percentile >= 0.5) {
    return "high";
  }
  if (percentile >= 0.25) {
    return "mid";
  }
  return "low";
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

export function getPlacementXp(finalRank: number, lobbySize: number) {
  const percentile = getPlacementPercentile(finalRank, lobbySize);
  const placementBand = getPlacementBand(percentile);
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
  const percentile = getPlacementPercentile(finalRank, lobbySize);
  const placementBand = getPlacementBand(percentile);
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
