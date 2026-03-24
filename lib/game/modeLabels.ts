import type { SpikeItemCount } from "./deck";

export const spikeItemCountLabels: Record<SpikeItemCount, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const rowClearLabel = "Row clears";
export const endGameBonusesLabel = "End game bonuses";

export const getSpikeItemCountLabel = (count: SpikeItemCount | null | undefined) =>
  spikeItemCountLabels[count ?? "low"] ?? spikeItemCountLabels.low;

export const getRowClearLabel = (spikeRowClear: boolean | null | undefined) =>
  spikeRowClear ? rowClearLabel : "";

export const getEndGameBonusesLabel = (spikeEndGameBonuses: boolean | null | undefined) =>
  spikeEndGameBonuses ? endGameBonusesLabel : "";

export const getModeLabel = (spikeMode: boolean | null | undefined) =>
  spikeMode ? "Spike" : "Classic";

export const getModeDetails = (
  spikeMode: boolean | null | undefined,
  spikeItemCount: SpikeItemCount | null | undefined,
  spikeRowClear: boolean | null | undefined,
  spikeEndGameBonuses: boolean | null | undefined,
  targetScore: 50 | 100 | null | undefined
) => {
  const resolvedTargetScore = targetScore === 50 ? 50 : 100;
  if (!spikeMode) {
    return resolvedTargetScore === 50 ? "Classic rules • 50-point game" : "Classic rules";
  }
  const itemLabel = getSpikeItemCountLabel(spikeItemCount);
  const rowClear = getRowClearLabel(spikeRowClear);
  const endGameBonuses = getEndGameBonusesLabel(spikeEndGameBonuses);
  return [itemLabel, rowClear, endGameBonuses, `First to ${resolvedTargetScore}`]
    .filter(Boolean)
    .join(" • ");
};
