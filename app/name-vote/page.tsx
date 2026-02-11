'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  getCurrentNameVotingMatchup,
  getNameVoteProgressLabel,
  ensureNameVotingSession,
  type NameVotingMatchup,
} from '../../lib/nameVoting';
import { hasUserVotedForMatchup, submitNameVote, type NameVoteSide } from '../../lib/nameVoteActions';
import { useAnonymousAuth } from '../../lib/auth';

const DEFAULT_NAME_VOTING_SESSION_ID = 'default-session';

export default function NameVotePage() {
  const { uid, error: authError } = useAnonymousAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentMatchup, setCurrentMatchup] = useState<(NameVotingMatchup & { id: string }) | null>(null);
  const [isVoting, setIsVoting] = useState(false);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);
  const [hasVotedCurrentMatchup, setHasVotedCurrentMatchup] = useState(false);

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

  useEffect(() => {
    let isMounted = true;

    const loadVoteStatus = async () => {
      if (!uid || !currentMatchup) {
        if (isMounted) {
          setHasVotedCurrentMatchup(false);
        }
        return;
      }

      try {
        const hasVoted = await hasUserVotedForMatchup(
          DEFAULT_NAME_VOTING_SESSION_ID,
          currentMatchup.id,
          uid
        );

        if (isMounted) {
          setHasVotedCurrentMatchup(hasVoted);
        }
      } catch (error) {
        if (isMounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load vote status.');
        }
      }
    };

    void loadVoteStatus();

    return () => {
      isMounted = false;
    };
  }, [currentMatchup, uid]);

  const votingLocked = isVoting || Boolean(transitionMessage) || hasVotedCurrentMatchup || !uid;

  const progressLabel = useMemo(() => {
    if (!currentMatchup) {
      return '0 / 0 votes';
    }

    return getNameVoteProgressLabel(currentMatchup.totalVotes, currentMatchup.voteTarget);
  }, [currentMatchup]);

  const submitVote = async (voteSide: NameVoteSide) => {
    if (!currentMatchup || votingLocked) {
      return;
    }

    if (!uid) {
      setLoadError('Sign-in is still in progress. Please wait a moment and try again.');
      return;
    }

    setIsVoting(true);
    setLoadError(null);

    try {
      const result = await submitNameVote(
        DEFAULT_NAME_VOTING_SESSION_ID,
        currentMatchup.id,
        voteSide,
        uid
      );

      setHasVotedCurrentMatchup(true);
      setCurrentMatchup((previous) => {
        if (!previous || previous.id !== result.matchupId) {
          return previous;
        }

        return {
          ...previous,
          leftVotes: result.leftVotes,
          rightVotes: result.rightVotes,
          totalVotes: result.totalVotes,
          status: result.status,
          winnerName: result.winnerName,
        };
      });

      if (result.justClosed && result.winnerName) {
        setTransitionMessage(`${result.winnerName} takes the matchup. Waiting for next round...`);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to submit vote.');
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

  if (authError) {
    return (
      <main>
        <div className="container">
          <section className="name-vote-card">
            <p className="notice">{authError}</p>
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
              onClick={() => void submitVote('left')}
            >
              {isVoting ? 'Submitting vote...' : `Vote ${currentMatchup.leftName}`}
            </button>
            <button
              className="form-button-full-width"
              type="button"
              disabled={votingLocked}
              onClick={() => void submitVote('right')}
            >
              {isVoting ? 'Submitting vote...' : `Vote ${currentMatchup.rightName}`}
            </button>
          </div>

          <p className="name-vote-progress">{progressLabel}</p>

          {transitionMessage ? (
            <p className="notice name-vote-transition">{transitionMessage}</p>
          ) : hasVotedCurrentMatchup ? (
            <p className="name-vote-helper">You already voted for this matchup.</p>
          ) : (
            <p className="name-vote-helper">Cast your vote to move this matchup forward.</p>
          )}
        </section>
      </div>
    </main>
  );
}
