'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  getCurrentNameVotingMatchup,
  getNameVoteProgressLabel,
  ensureNameVotingSession,
  type NameVotingMatchup,
} from '../../lib/nameVoting';

const DEFAULT_NAME_VOTING_SESSION_ID = 'default-session';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function NameVotePage() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentMatchup, setCurrentMatchup] = useState<(NameVotingMatchup & { id: string }) | null>(null);
  const [votesSubmitted, setVotesSubmitted] = useState(0);
  const [isVoting, setIsVoting] = useState(false);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      try {
        await ensureNameVotingSession(DEFAULT_NAME_VOTING_SESSION_ID);
        const payload = await getCurrentNameVotingMatchup(DEFAULT_NAME_VOTING_SESSION_ID);

        if (!payload) {
          throw new Error('No name voting session found.');
        }

        if (!isMounted) {
          return;
        }

        setCurrentRound(payload.session.currentRound);
        setCurrentMatchup(payload.matchup);
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

  const votingLocked = isVoting || Boolean(transitionMessage);

  const progressLabel = useMemo(() => {
    if (!currentMatchup) {
      return '0 / 0 votes';
    }

    return getNameVoteProgressLabel(votesSubmitted, currentMatchup.voteTarget);
  }, [currentMatchup, votesSubmitted]);

  const submitVote = async (candidateName: string) => {
    if (!currentMatchup || votingLocked) {
      return;
    }

    setIsVoting(true);

    try {
      await wait(450);
      const nextVotes = votesSubmitted + 1;
      setVotesSubmitted(nextVotes);

      if (nextVotes >= currentMatchup.voteTarget) {
        setTransitionMessage(`${candidateName} takes the matchup. Waiting for next round...`);
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

  if (!currentMatchup) {
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
            Round <strong>{currentRound}</strong> • Matchup <strong>{currentMatchup.id}</strong>
          </p>

          <div className="name-vote-candidates">
            <article className="name-vote-candidate">{currentMatchup.leftName}</article>
            <article className="name-vote-candidate">{currentMatchup.rightName}</article>
          </div>

          <div className="name-vote-actions">
            <button
              className="form-button-full-width"
              type="button"
              disabled={votingLocked}
              onClick={() => void submitVote(currentMatchup.leftName)}
            >
              {isVoting ? 'Submitting vote...' : `Vote ${currentMatchup.leftName}`}
            </button>
            <button
              className="form-button-full-width"
              type="button"
              disabled={votingLocked}
              onClick={() => void submitVote(currentMatchup.rightName)}
            >
              {isVoting ? 'Submitting vote...' : `Vote ${currentMatchup.rightName}`}
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
