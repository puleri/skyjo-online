import Link from "next/link";

export default function RulesPage() {
  return (
    <main className="rules-page">
      <div className="rules-page__header">
        <h1>Spike Mode — Official Rules Sheet</h1>
        <p className="rules-subtitle">Working title: SPIKE</p>
        <Link href="/" className="rules-back-link">
          ← Back to lobby
        </Link>
      </div>

      <section className="rules-card">
        <h2>1) Goal</h2>
        <p>Have the lowest total score after the agreed number of rounds.</p>
        <ul>
          <li>A round ends when one player reveals all cards on their grid.</li>
          <li>All other players take one final turn, then scoring occurs.</li>
        </ul>
      </section>

      <section className="rules-card">
        <h2>2) Components</h2>
        <ul>
          <li>Number cards (draw deck + discard pile)</li>
          <li>Item cards (special effects)</li>
          <li>Player grids (face-down at setup)</li>
        </ul>
        <p className="rules-callout">
          Item cards are shuffled into the draw deck after player grids are dealt, so they will
          never appear in starting grids.
        </p>
        <ul>
          <li>2–4 players: shuffle in 10 item cards</li>
          <li>5–8 players: shuffle in 15 item cards</li>
        </ul>
      </section>

      <section className="rules-card">
        <h2>3) Setup (Per Round)</h2>
        <ol>
          <li>Each player builds their standard SPIKE grid face-down.</li>
          <li>Reveal starting cards according to standard setup.</li>
          <li>Create the draw deck.</li>
          <li>Reveal one card to start the discard pile.</li>
          <li>Shuffle in item cards (based on player count).</li>
        </ol>
      </section>

      <section className="rules-card">
        <h2>4) Turn Structure</h2>
        <ol>
          <li>Look at the top discard card.</li>
          <li>
            Choose one: <strong>Take the discard</strong> or <strong>Draw from the unrevealed deck</strong>.
          </li>
          <li>
            After you have a card in hand, choose one:
            <ul>
              <li>
                <strong>A) Keep &amp; Trade</strong>: Swap the card in your hand with a card on your
                board (revealed or unrevealed), then discard the replaced card.
              </li>
              <li>
                <strong>B) Discard &amp; Reveal</strong>: Discard the drawn/taken card, then reveal one
                unrevealed card on your grid.
              </li>
            </ul>
          </li>
          <li>Your turn ends.</li>
        </ol>

        <div className="rules-animations">
          <div className="rules-animation-row">
            <span className="rules-animation-label">Draw</span>
            <div className="rules-animation rules-animation--draw" aria-hidden="true">
              <span className="card-chip">Deck</span>
              <span className="card-chip">Hand</span>
            </div>
          </div>
          <div className="rules-animation-row">
            <span className="rules-animation-label">Reveal</span>
            <div className="rules-animation rules-animation--reveal" aria-hidden="true">
              <span className="card-chip">?</span>
              <span className="card-chip">8</span>
            </div>
          </div>
          <div className="rules-animation-row">
            <span className="rules-animation-label">Discard</span>
            <div className="rules-animation rules-animation--discard" aria-hidden="true">
              <span className="card-chip">Hand</span>
              <span className="card-chip">Pile</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rules-card">
        <h2>5) Clearing Rules (Spike Mode Core)</h2>
        <p>
          A row or column clears if all cards in it are revealed and all values are identical.
          Cleared rows/columns are removed (or marked cleared) and score 0 points.
        </p>
        <ul>
          <li>If a full column meets the clear condition, clear it.</li>
          <li>If a full row meets the clear condition, clear it.</li>
        </ul>
      </section>

      <section className="rules-card">
        <h2>6) Pick-a-Path Rule (Commitment Rule)</h2>
        <p>The first time you clear in a round, you commit:</p>
        <ul>
          <li>If your first clear is a row, you may only clear rows for the rest of the round.</li>
          <li>
            If your first clear is a column, you may only clear columns for the rest of the round.
          </li>
        </ul>
        <p>You may still play normally; this only restricts what can be cleared.</p>
      </section>

      <section className="rules-card">
        <h2>7) Spike Rule</h2>
        <p>
          If a row and a column both meet the clear condition at the same time, they may both be
          cleared simultaneously. This is called a <strong>Spike</strong>.
        </p>
        <p>
          A Spike satisfies your first-clear commitment based on the orientation of the first clear
          that becomes valid during the turn. If both become valid simultaneously, the player
          chooses which orientation they commit to for the round.
        </p>
      </section>

      <section className="rules-card">
        <h2>8) Doubling Rule</h2>
        <ul>
          <li>
            If the player who triggered the end of the round does <strong>not</strong> have the unique
            lowest score, their round score is doubled.
          </li>
          <li>If tied for lowest, they still double.</li>
          <li>Only a strictly lower score by that player avoids doubling.</li>
        </ul>
      </section>

      <section className="rules-card">
        <h2>9) Item Cards</h2>
        <p>
          Item cards are played immediately when drawn (unless your group prefers optional holding;
          default is immediate play).
        </p>
        <ul>
          <li>
            <strong>Swap</strong>: Swap the positions of two cards on your board.
          </li>
          <li>
            <strong>Mist</strong>: For your next 5 turns, other players may not view your board.
          </li>
          <li>
            <strong>Wild Card</strong>: Set one card on your board to any value.
          </li>
          <li>
            <strong>Push</strong>: Draw three cards consecutively from the draw pile. For each card,
            immediately trade it with a card on your board; each trade resolves before drawing the
            next card. Replaced cards are discarded immediately.
          </li>
          <li>
            <strong>Randomize</strong>: Choose one card on your board and randomize its value.
          </li>
        </ul>
      </section>

      <section className="rules-card">
        <h2>10) End of Round &amp; Scoring</h2>
        <ol>
          <li>A player reveals all cards → round ends.</li>
          <li>All other players take one final turn.</li>
          <li>Apply any valid clears (rows, columns, or Spike).</li>
          <li>Score all remaining cards.</li>
          <li>Apply the doubling rule if necessary.</li>
          <li>Add round scores to the running total.</li>
        </ol>
        <p>Lowest total after the agreed number of rounds wins.</p>
        <p className="rules-callout">
          End-of-game bonuses can also be enabled: fastest player, most points cleared, and lowest
          points discarded.
        </p>
      </section>
    </main>
  );
}
