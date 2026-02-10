'use client';

import { useEffect, useMemo, useState } from 'react';

type Matchup = {
  id: string;
  candidates: [string, string];
  totalVotes: number;
};

type RoundData = {
  id: string;
  matchups: Matchup[];
};

const rounds: RoundData[] = [
  {
    id: 'round-1',
    matchups: [
      { id: 'r1-m1', candidates: ['Aurora', 'Juniper'], totalVotes: 7 },
      { id: 'r1-m2', candidates: ['Maple', 'Poppy'], totalVotes: 7 },
    ],
  },
  {
    id: 'round-2',
    matchups: [{ id: 'r2-m1', candidates: ['Aurora', 'Maple'], totalVotes: 7 }],
  },
];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function NameVotePage() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [roundIndex, setRoundIndex] = useState(0);
  const [matchupIndex, setMatchupIndex] = useState(0);
  const [votesSubmitted, setVotesSubmitted] = useState(0);
  const [isVoting, setIsVoting] = useState(false);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      try {
        await wait(500);
        if (!isMounted) {
          return;
        }
        setLoadError(null);
      } catch (error) {
        if (isMounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load matchup.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      isMounted = false;
    };
  }, []);

  const currentRound = rounds[roundIndex];
  const currentMatchup = currentRound?.matchups[matchupIndex] ?? null;
  const votingLocked = isVoting || Boolean(transitionMessage);

  const progressLabel = useMemo(() => {
    if (!currentMatchup) {
      return '0 / 0 votes';
    }
    return `${votesSubmitted} / ${currentMatchup.totalVotes} votes`;
  }, [currentMatchup, votesSubmitted]);

  const advanceToNextMatchup = async () => {
    if (!currentRound || !currentMatchup) {
      return;
    }

    setTransitionMessage(`Matchup ${matchupIndex + 1} closed. Tallying votes...`);
    await wait(1000);

    const isLastMatchupInRound = matchupIndex >= currentRound.matchups.length - 1;

    if (!isLastMatchupInRound) {
      setMatchupIndex((value) => value + 1);
      setVotesSubmitted(0);
      setTransitionMessage(null);
      return;
    }

    const hasMoreRounds = roundIndex < rounds.length - 1;
    if (!hasMoreRounds) {
      setTransitionMessage('Voting complete. Final name selected!');
      return;
    }

    setTransitionMessage(`Round ${roundIndex + 1} complete. Advancing to round ${roundIndex + 2}...`);
    await wait(1100);
    setRoundIndex((value) => value + 1);
    setMatchupIndex(0);
    setVotesSubmitted(0);
    setTransitionMessage(null);
  };

  const submitVote = async (_candidateName: string) => {
    if (!currentMatchup || votingLocked) {
      return;
    }

    setIsVoting(true);
    try {
      await wait(550);
      const nextVotes = votesSubmitted + 1;
      setVotesSubmitted(nextVotes);

      if (nextVotes >= currentMatchup.totalVotes) {
        await advanceToNextMatchup();
      }
    } finally {
      setIsVoting(false);
    }
  };

  if (isLoading) {
    return (
      <main>
        <div className="container">
          <section className="name-vote-card">
            <h2 className="leaderboard-title">Loading name vote...</h2>
            <p className="leaderboard-sub">Pulling the current round and matchup.</p>
          </section>
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main>
        <div className="container">
          <section className="name-vote-card">
            <p className="notice">{loadError}</p>
          </section>
        </div>
      </main>
    );
  }

  if (!currentRound || !currentMatchup) {
    return (
      <main>
        <div className="container">
          <section className="name-vote-card">
            <p className="notice">No matchups are available.</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="container name-vote-shell">
        <section className="name-vote-card" aria-live="polite">
          <h2 className="leaderboard-title">Name Vote</h2>
          <p className="leaderboard-sub">
            Round <strong>{roundIndex + 1}</strong> • Matchup <strong>{matchupIndex + 1}</strong>
          </p>

          <div className="name-vote-candidates">
            <article className="name-vote-candidate">{currentMatchup.candidates[0]}</article>
            <article className="name-vote-candidate">{currentMatchup.candidates[1]}</article>
          </div>

          <div className="name-vote-actions">
            <button
              className="form-button-full-width"
              type="button"
              disabled={votingLocked}
              onClick={() => void submitVote(currentMatchup.candidates[0])}
            >
              {isVoting ? 'Submitting vote...' : `Vote ${currentMatchup.candidates[0]}`}
            </button>
            <button
              className="form-button-full-width"
              type="button"
              disabled={votingLocked}
              onClick={() => void submitVote(currentMatchup.candidates[1])}
            >
              {isVoting ? 'Submitting vote...' : `Vote ${currentMatchup.candidates[1]}`}
            </button>
          </div>

          <p className="name-vote-progress">{progressLabel}</p>

          {transitionMessage ? (
            <p className="notice name-vote-transition">{transitionMessage}</p>
          ) : (
            <p className="name-vote-helper">Cast your vote to move this matchup forward.</p>
          )}
        </section>
      </div>
    </main>
  );
}
