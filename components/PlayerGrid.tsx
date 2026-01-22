"use client";

import type { Card, ItemCard } from "../lib/game/deck";

type PlayerGridProps = {
  playerId: string;
  label: string;
  size?: "main" | "mini";
  isActive?: boolean;
  isLocal?: boolean;
  grid?: Array<Card | null>;
  revealed?: boolean[];
  onCardSelect?: (index: number) => void;
  activeActionIndex?: number | null;
  onReplace?: (index: number) => void;
  onReveal?: (index: number) => void;
  onCancel?: () => void;
  revealSelectionActive?: boolean;
  itemSelection?: {
    active: boolean;
    targets: Array<{ playerId: string; index: number }>;
    onSelect?: (target: { playerId: string; index: number }) => void;
  };
};

const placeholderCards = Array.from({ length: 12 }, (_, index) => index + 1);

const isItemCard = (value: Card | null | undefined): value is ItemCard =>
  value !== null &&
  value !== undefined &&
  typeof value === "object" &&
  "kind" in value &&
  value.kind === "item";

const getCardValueClass = (value: Card | null | undefined) => {
  if (typeof value !== "number") {
    return "";
  }

    if (value < 0) {
      return " card--value-negative";
    }
    if (value === 0) {
      return " card--value-zero";
    }
    if (value <= 3) {
      return " card--value-low";
    }
    if (value <= 6) {
      return " card--value-mid";
    }
    if (value <= 9) {
      return " card--value-high";
    }
    return " card--value-max";
};

const getCardItemClass = (value: Card | null | undefined) => {
  if (!isItemCard(value)) {
    return "";
  }
  return ` card--item card--item-${value.code}`;
};

const getCardLabel = (value: Card | null | undefined) => {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object") {
    return value.code;
  }
  return "—";
};

export default function PlayerGrid({
  playerId,
  label,
  size = "main",
  isActive = false,
  isLocal = false,
  grid,
  revealed,
  onCardSelect,
  activeActionIndex,
  onReplace,
  onReveal,
  onCancel,
  revealSelectionActive = false,
  itemSelection,
}: PlayerGridProps) {
  const cards = grid && grid.length === 12 ? grid : placeholderCards;
  const visibility =
    revealed && revealed.length === 12
      ? revealed
      : Array.from({ length: cards.length }, () => false);
  const isSelectable = typeof onCardSelect === "function";
  const isRevealSelectionActive = Boolean(revealSelectionActive) && isSelectable;
  const isItemSelectionActive =
    Boolean(itemSelection?.active) && typeof itemSelection?.onSelect === "function";
  const hasRealGrid = Boolean(grid && grid.length === 12);
  const showActionMenu =
    typeof activeActionIndex === "number" &&
    typeof onReplace === "function" &&
    typeof onReveal === "function" &&
    typeof onCancel === "function";

  return (
    <section
      className={`player-grid player-grid--${size}${isLocal ? " player-grid--local" : ""}${
        isActive ? " player-grid--active" : ""
      }`}
    >
      <header>
        <strong>{label}</strong>
      </header>
      <div className="player-grid__cards">
        {cards.map((value, index) => {
          const isRevealed = visibility[index];
          const cardClassName = `card${
            isRevealed
              ? `${getCardValueClass(value)}${getCardItemClass(value)}`
              : " card--back card--back-text"
          }`;
          const isActive = typeof activeActionIndex === "number" && activeActionIndex === index;
          const isItemSelectable =
            isItemSelectionActive &&
            hasRealGrid &&
            value !== null &&
            value !== undefined;
          const isRevealSelectable =
            isRevealSelectionActive &&
            hasRealGrid &&
            !isRevealed &&
            value !== null &&
            value !== undefined;
          const targetOrderIndex = itemSelection?.targets.findIndex(
            (target) => target.playerId === playerId && target.index === index
          );
          const isTargetSelected = typeof targetOrderIndex === "number" && targetOrderIndex >= 0;
          return (
            <div
              key={`${label}-${index}`}
              className={`player-grid__card${
                isActive ? " player-grid__card--active player-grid__card--menu-open" : ""
              }${isItemSelectable ? " player-grid__card--item-selectable" : ""}${
                isTargetSelected ? " player-grid__card--item-selected" : ""
              }${isRevealSelectable ? " player-grid__card--reveal-selectable" : ""
              }`}
            >
              {isSelectable || isItemSelectable ? (
                <button
                  type="button"
                  className={cardClassName}
                  aria-haspopup={showActionMenu ? "menu" : undefined}
                  onClick={() => {
                    if (isItemSelectable && itemSelection?.onSelect) {
                      itemSelection.onSelect({ playerId, index });
                      return;
                    }
                    if (onCardSelect) {
                      onCardSelect(index);
                    }
                  }}
                  disabled={
                    !isItemSelectable && (!isSelectable || (isRevealSelectionActive && isRevealed))
                  }
                >
                  <span className="card__value">{isRevealed ? getCardLabel(value) : ""}</span>
                  {isItemSelectable ? (
                    <span className="card__target-overlay" aria-hidden="true">
                      {isTargetSelected ? `${targetOrderIndex + 1}` : "+"}
                    </span>
                  ) : null}
                </button>
              ) : (
                <div className={cardClassName}>
                  <span className="card__value">{isRevealed ? getCardLabel(value) : ""}</span>
                  {isItemSelectable ? (
                    <span className="card__target-overlay" aria-hidden="true">
                      {isTargetSelected ? `${targetOrderIndex + 1}` : "+"}
                    </span>
                  ) : null}
                </div>
              )}
              {showActionMenu && activeActionIndex === index ? (
                <div className="player-grid__actions" role="menu">
                  <button
                    type="button"
                    className="player-grid__action player-grid__action--primary"
                    onClick={() => onReplace(index)}
                  >
                    <span className="player-grid__action-icon" aria-hidden="true">
                      <img className="action-menu-icon" src="/trade-icon.svg" alt="" />
                    </span>
                    Trade
                  </button>
                  <button
                    type="button"
                    className="player-grid__action"
                    onClick={() => onReveal(index)}
                    disabled={isRevealed}
                  >
                    <span className="player-grid__action-icon invert" aria-hidden="true">
                      <img className="action-menu-icon" src="/keep-icon.svg" alt="" />
                    </span>
                    Reveal
                  </button>
                  <button
                    type="button"
                    className="player-grid__action player-grid__action--ghost player-grid__action--cancel"
                    onClick={onCancel}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
