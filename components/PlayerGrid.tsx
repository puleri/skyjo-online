"use client";

type PlayerGridProps = {
  label: string;
  size?: "main" | "mini";
  isActive?: boolean;
  isLocal?: boolean;
  grid?: Array<number | null>;
  revealed?: boolean[];
  onCardSelect?: (index: number) => void;
  activeActionIndex?: number | null;
  onReplace?: (index: number) => void;
  onReveal?: (index: number) => void;
  onCancel?: () => void;
};

const placeholderCards = Array.from({ length: 12 }, (_, index) => index + 1);

const getCardValueClass = (value: number | null | undefined) => {
  if (typeof value !== "number") {
    return "";
  }

  if (value <= -1) {
    return " card--value-negative";
  }

  if (value === 0) {
    return " card--value-zero";
  }

  if (value <= 3) {
    return " card--value-low";
  }

  if (value <= 5) {
    return " card--value-mid";
  }

  if (value <= 8) {
    return " card--value-high";
  }

  return " card--value-max";
};

export default function PlayerGrid({
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
}: PlayerGridProps) {
  const cards = grid && grid.length === 12 ? grid : placeholderCards;
  const visibility =
    revealed && revealed.length === 12
      ? revealed
      : Array.from({ length: cards.length }, () => false);
  const isSelectable = typeof onCardSelect === "function";
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
            isRevealed ? getCardValueClass(value) : " card--back card--back-text"
          }`;
          const isActive = typeof activeActionIndex === "number" && activeActionIndex === index;
          return (
            <div
              key={`${label}-${index}`}
              className={`player-grid__card${isActive ? " player-grid__card--active" : ""}`}
            >
              {isSelectable ? (
                <button
                  type="button"
                  className={cardClassName}
                  aria-haspopup={showActionMenu ? "menu" : undefined}
                  onClick={() => onCardSelect(index)}
                >
                  {isRevealed ? value ?? "—" : "Skyjo"}
                </button>
              ) : (
                <div className={cardClassName}>{isRevealed ? value ?? "—" : "Skyjo"}</div>
              )}
              {showActionMenu && activeActionIndex === index ? (
                <div className="player-grid__actions" role="menu">
                  <button
                    type="button"
                    className="player-grid__action player-grid__action--primary"
                    onClick={() => onReplace(index)}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="player-grid__action"
                    onClick={() => onReveal(index)}
                  >
                    Reveal
                  </button>
                  <button
                    type="button"
                    className="player-grid__action player-grid__action--ghost"
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
