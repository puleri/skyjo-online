import type { SpikeItemCount } from "./deck";

export const spikeItemCountLabels: Record<SpikeItemCount, string> = {
  none: "No items",
  low: "Low items",
  medium: "Medium items",
  high: "High items",
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
  spikeEndGameBonuses: boolean | null | undefined
) => {
  if (!spikeMode) {
    return "Classic rules";
  }
  const itemLabel = getSpikeItemCountLabel(spikeItemCount);
  const rowClear = getRowClearLabel(spikeRowClear);
  const endGameBonuses = getEndGameBonusesLabel(spikeEndGameBonuses);
  return [itemLabel, rowClear, endGameBonuses].filter(Boolean).join(" • ");
};
