"use client";

import { useRouter } from "next/navigation";

type GameScreenProps = {
  gameId: string;
};

const placeholderCards = Array.from({ length: 12 }, (_, index) => `Card ${index + 1}`);
const placeholderOpponents = ["Opponent 1", "Opponent 2", "Opponent 3"];

export default function GameScreen({ gameId }: GameScreenProps) {
  const router = useRouter();

  return (
    <main className="game-screen">
      <section className="game-header">
        <div className="game-header__actions">
          <button type="button" onClick={() => router.back()}>
            Back
          </button>
          <button type="button" onClick={() => router.push("/")}>Back to main menu</button>
        </div>
        <div>
          <h1>Game {gameId}</h1>
          <p>Waiting for real-time game data. Placeholder layout below.</p>
        </div>
      </section>

      <section className="game-board">
        <div className="game-piles">
          <div className="game-pile">
            <h2>Deck</h2>
            <div className="card-slot">Draw pile</div>
          </div>
          <div className="game-pile">
            <h2>Discard</h2>
            <div className="card-slot">Discard pile</div>
          </div>
        </div>

        <div>
          <h2>Main grid</h2>
          <div className="card-grid">
            {placeholderCards.map((card) => (
              <div key={card} className="card-slot">
                {card}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2>Mini grids</h2>
          <div className="mini-grids">
            {placeholderOpponents.map((opponent) => (
              <div key={opponent} className="mini-grid">
                <h3>{opponent}</h3>
                <div className="card-grid card-grid--mini">
                  {placeholderCards.slice(0, 6).map((card) => (
                    <div key={`${opponent}-${card}`} className="card-slot">
                      {card}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
