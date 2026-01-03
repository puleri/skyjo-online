"use client";

type PlayerGridProps = {
  label: string;
  size?: "main" | "mini";
  grid?: Array<number | null>;
};

const placeholderCards = Array.from({ length: 12 }, (_, index) => index + 1);

export default function PlayerGrid({ label, size = "main", grid }: PlayerGridProps) {
  const cards = grid && grid.length === 12 ? grid : placeholderCards;
  return (
    <section className={`player-grid player-grid--${size}`}>
      <header>
        <strong>{label}</strong>
      </header>
      <div className="player-grid__cards">
        {cards.map((value, index) => (
          <div key={`${label}-${index}`} className="card">
            {value ?? "—"}
          </div>
        ))}
      </div>
    </section>
  );
}
