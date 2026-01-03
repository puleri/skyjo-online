"use client";

type PlayerGridProps = {
  label: string;
  size?: "main" | "mini";
  grid?: Array<number | null>;
  revealed?: boolean[];
  onCardSelect?: (index: number) => void;
  activeActionIndex?: number | null;
  onReplace?: (index: number) => void;
  onReveal?: (index: number) => void;
  onCancel?: () => void;
};

const placeholderCards = Array.from({ length: 12 }, (_, index) => index + 1);

export default function PlayerGrid({
  label,
  size = "main",
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
    <section className={`player-grid player-grid--${size}`}>
      <header>
        <strong>{label}</strong>
      </header>
      <div className="player-grid__cards">
        {cards.map((value, index) => {
          const isRevealed = visibility[index];
          const cardClassName = `card${isRevealed ? "" : " card--back card--back-text"}`;
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
