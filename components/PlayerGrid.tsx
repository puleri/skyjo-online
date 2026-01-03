"use client";

type PlayerGridProps = {
  label: string;
  size?: "main" | "mini";
  grid?: Array<number | null>;
  revealed?: boolean[];
};

const placeholderCards = Array.from({ length: 12 }, (_, index) => index + 1);

export default function PlayerGrid({ label, size = "main", grid, revealed }: PlayerGridProps) {
  const cards = grid && grid.length === 12 ? grid : placeholderCards;
  const visibility =
    revealed && revealed.length === 12
      ? revealed
      : Array.from({ length: cards.length }, () => false);
  return (
    <section className={`player-grid player-grid--${size}`}>
      <header>
        <strong>{label}</strong>
      </header>
      <div className="player-grid__cards">
        {cards.map((value, index) => {
          const isRevealed = visibility[index];
          return (
            <div
              key={`${label}-${index}`}
              className={`card${isRevealed ? "" : " card--back card--back-text"}`}
            >
              {isRevealed ? value ?? "—" : "Skyjo"}
            </div>
          );
        })}
      </div>
    </section>
  );
}
