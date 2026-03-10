"use client";

import { useMemo } from "react";

import type { Card, ItemCard, ItemCode } from "../lib/game/deck";

type PlayerGridProps = {
  playerId: string;
  label: string;
  size?: "main" | "mini";
  isActive?: boolean;
  isLocal?: boolean;
  grid?: Array<Card | null>;
  revealed?: boolean[];
  mistTurnsRemaining?: number | null;
  onCardSelect?: (index: number) => void;
  onPlayerSelect?: (playerId: string) => void;
  isPlayerSelected?: boolean;
  activeActionIndex?: number | null;
  onReplace?: (index: number) => void;
  onReveal?: (index: number) => void;
  onCancel?: () => void;
  revealSelectionActive?: boolean;
  disableActionControls?: boolean;
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
    if (value <= 12) {
      return " card--value-max";
    }
    return " card--value-legend";
};

const getCardItemClass = (value: Card | null | undefined) => {
  if (!isItemCard(value)) {
    return "";
  }
  return ` card--item card--item-${value.code}`;
};

const itemCardDetails: Record<ItemCode, { name: string; image: string; eyebrow: string }> = {
  C: { name: "Wild", image: "/cards/wild.png", eyebrow: "Wild" },
  E: { name: "Swap", image: "/cards/swap.png", eyebrow: "Swap" },
  F: { name: "Mist", image: "/cards/mist.png", eyebrow: "Mist" },
  G: { name: "Push", image: "/cards/push.png", eyebrow: "Push" },
  H: { name: "Mirror", image: "/cards/mirror.png", eyebrow: "Mirror" },
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

const renderItemContent = (code: ItemCode) => {
  const details = itemCardDetails[code];
  return (
    <span className="card__item-content">
      <span className="card__item-eyebrow">{details.eyebrow}</span>
      <img className="card__item-art" src={details.image} alt={`${details.name} item art`} />
    </span>
  );
};

export default function PlayerGrid({
  playerId,
  label,
  size = "main",
  isActive = false,
  isLocal = false,
  grid,
  revealed,
  mistTurnsRemaining,
  onCardSelect,
  onPlayerSelect,
  isPlayerSelected = false,
  activeActionIndex,
  onReplace,
  onReveal,
  onCancel,
  revealSelectionActive = false,
  disableActionControls = false,
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
  const isMisted = (mistTurnsRemaining ?? 0) > 0;
  const showActionMenu =
    typeof activeActionIndex === "number" &&
    typeof onReplace === "function" &&
    typeof onCancel === "function";
  const itemTargetOrderLookup = useMemo(() => {
    const lookup = new Map<string, number>();

    if (!itemSelection?.targets) {
      return lookup;
    }

    itemSelection.targets.forEach((target, targetOrderIndex) => {
      lookup.set(`${target.playerId}:${target.index}`, targetOrderIndex);
    });

    return lookup;
  }, [itemSelection?.targets]);

  return (
    <section
      className={`player-grid player-grid--${size}${isLocal ? " player-grid--local" : ""}${
        isActive ? " player-grid--active" : ""
      }${isMisted ? " " : ""}`}
    >
      <header className="player-grid__header">
        {onPlayerSelect ? (
          <button
            type="button"
            className={`player-grid__name${isPlayerSelected ? " player-grid__name--selected" : ""}`}
            onClick={() => onPlayerSelect(playerId)}
          >
            <strong>{label}</strong>
          </button>
        ) : (
          <strong className="player-grid__name">{label}</strong>
        )}
        {isMisted ? (
          <span className="player-grid__badge player-grid__badge--misted">
            Misty{mistTurnsRemaining && mistTurnsRemaining > 1 ? ` (${mistTurnsRemaining})` : ""}
          </span>
        ) : null}
      </header>
      <div className="player-grid__cards">
        {cards.map((value, index) => {
          const isRevealed = visibility[index];
          const isItem = isItemCard(value);
          const cardClassName = `card${
            isRevealed
              ? `${getCardValueClass(value)}${getCardItemClass(value)}`
              : " card--back card--back-text"
          }`;
          const isActive = typeof activeActionIndex === "number" && activeActionIndex === index;
          const isItemSelectable =
            isItemSelectionActive &&
            hasRealGrid &&
            ((value !== null && value !== undefined) || !isRevealed);
          const isRevealSelectable =
            isRevealSelectionActive &&
            hasRealGrid &&
            !isRevealed &&
            value !== null &&
            value !== undefined;
          const targetOrderIndex = itemTargetOrderLookup.get(`${playerId}:${index}`);
          const isTargetSelected = typeof targetOrderIndex === "number";
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
                    disableActionControls ||
                    (!isItemSelectable && (!isSelectable || (isRevealSelectionActive && isRevealed)))
                  }
                >
                  {isRevealed && value !== null && value !== undefined ? (
                    isItem ? (
                      renderItemContent(value.code)
                    ) : (
                      <span className="card__value">{getCardLabel(value)}</span>
                    )
                  ) : null}
                  {isItemSelectable ? (
                    <span className="card__target-overlay" aria-hidden="true">
                      {isTargetSelected ? `${targetOrderIndex + 1}` : "+"}
                    </span>
                  ) : null}
                </button>
              ) : (
                <div className={cardClassName}>
                  {isRevealed && value !== null && value !== undefined ? (
                    isItem ? (
                      renderItemContent(value.code)
                    ) : (
                      <span className="card__value">{getCardLabel(value)}</span>
                    )
                  ) : null}
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
                    disabled={disableActionControls}
                  >
                    <span className="player-grid__action-icon" aria-hidden="true">
                      <img className="action-menu-icon" src="/trade-icon.svg" alt="" />
                    </span>
                    Trade
                  </button>
                  {typeof onReveal === "function" ? (
                    <button
                      type="button"
                      className="player-grid__action"
                      onClick={() => onReveal(index)}
                      disabled={disableActionControls || isRevealed}
                    >
                      <span className="player-grid__action-icon" aria-hidden="true">
                        <img className="action-menu-icon" src="/eye-icon.svg" alt="" />
                      </span>
                      Reveal
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="player-grid__action player-grid__action--ghost player-grid__action--cancel"
                    onClick={onCancel}
                    disabled={disableActionControls}
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
