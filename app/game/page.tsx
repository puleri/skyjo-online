import Link from "next/link";
import PlayerGrid from "../../components/PlayerGrid";

export default function GamePage() {
  return (
    <main className="game-screen">
      <header className="game-screen__header">
        <Link className="back-button" href="/">
          ← Back to main menu
        </Link>
        <h1>Skyjo Match</h1>
      </header>

      <section className="game-screen__players">
        <PlayerGrid label="Avery" size="mini" />
        <PlayerGrid label="Jordan" size="mini" />
        <PlayerGrid label="Casey" size="mini" />
      </section>

      <section className="game-screen__table">
        <div className="pile">
          <span>Deck</span>
          <img className="card-back-image" src="/skyjo-card-back.svg" alt="Skyjo card back" />
        </div>
        <PlayerGrid label="You" size="main" />
        <div className="pile">
          <span>Discard</span>
          <div className="card card--value-negative">-1</div>
        </div>
      </section>
    </main>
  );
}
