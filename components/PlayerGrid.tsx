"use client";

type PlayerGridProps = {
  label: string;
  size?: "main" | "mini";
};

const placeholderCards = Array.from({ length: 12 }, (_, index) => index + 1);

export default function PlayerGrid({ label, size = "main" }: PlayerGridProps) {
  return (
    <section className={`player-grid player-grid--${size}`}>
      <header>
        <strong>{label}</strong>
      </header>
      <div className="player-grid__cards">
        {placeholderCards.map((value) => (
          <div key={`${label}-${value}`} className="card">
            {value}
          </div>
        ))}
      </div>
    </section>
  );
}
