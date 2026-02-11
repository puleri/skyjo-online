'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import {
  getCurrentNameVotingMatchup,
  getNameVoteProgressLabel,
  getRoundNameVotingMatchups,
  ensureNameVotingSession,
  type NameVotingMatchupWithId,
} from '../../lib/nameVoting';
import { hasUserVotedForMatchup, submitNameVote, type NameVoteSide } from '../../lib/nameVoteActions';
import { useAnonymousAuth } from '../../lib/auth';

const DEFAULT_NAME_VOTING_SESSION_ID = 'default-session';
const VOTE_MODAL_EXIT_MS = 320;

type VoteFeedbackState = {
  candidateName: string;
  percent: number;
  phase: 'enter' | 'exit';
};

export default function NameVotePage() {
  const { uid, error: authError } = useAnonymousAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentMatchup, setCurrentMatchup] = useState<NameVotingMatchupWithId | null>(null);
  const [roundMatchups, setRoundMatchups] = useState<NameVotingMatchupWithId[]>([]);
  const [sessionStatus, setSessionStatus] = useState<'setup' | 'active' | 'complete'>('active');
  const [finalWinnerName, setFinalWinnerName] = useState<string | null>(null);
  const [isVoting, setIsVoting] = useState(false);
  const [voteFeedback, setVoteFeedback] = useState<VoteFeedbackState | null>(null);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);
  const [hasVotedCurrentMatchup, setHasVotedCurrentMatchup] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadSessionState = async (userId: string | null) => {
      await ensureNameVotingSession(DEFAULT_NAME_VOTING_SESSION_ID);
      const payload = await getCurrentNameVotingMatchup(DEFAULT_NAME_VOTING_SESSION_ID);

      if (!payload) {
        throw new Error('No name voting session found.');
      }

      const roundNumber = payload.session.currentRound;
      const matchups = await getRoundNameVotingMatchups(DEFAULT_NAME_VOTING_SESSION_ID, roundNumber);

      const openMatchups = matchups.filter((matchup) => matchup.status === 'open');
      let nextMatchup: NameVotingMatchupWithId | null = openMatchups[0] ?? null;

      if (userId) {
        for (const openMatchup of openMatchups) {
          const hasVoted = await hasUserVotedForMatchup(
            DEFAULT_NAME_VOTING_SESSION_ID,
            openMatchup.id,
            userId
          );

          if (!hasVoted) {
            nextMatchup = openMatchup;
            break;
          }

          nextMatchup = null;
        }
      }

      if (!isMounted) {
        return;
      }

      setCurrentRound(roundNumber);
      setRoundMatchups(matchups);
      setCurrentMatchup(nextMatchup);
      setSessionStatus(payload.session.status);
      setFinalWinnerName(payload.session.finalWinnerName ?? null);
      setHasVotedCurrentMatchup(false);
      setLoadError(null);
      setTransitionMessage(null);
    };

    const bootstrap = async () => {
      try {
        await loadSessionState(uid);
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
  }, [uid]);

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

  const matchupSummary = useMemo(() => {
    const totalMatchups = roundMatchups.length;
    const closedMatchups = roundMatchups.filter((matchup) => matchup.status === 'closed').length;
    const openMatchups = totalMatchups - closedMatchups;
    const completionPercent = totalMatchups > 0 ? Math.round((closedMatchups / totalMatchups) * 100) : 0;

    return {
      totalMatchups,
      closedMatchups,
      openMatchups,
      completionPercent,
    };
  }, [roundMatchups]);

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

    const nextTotalVotes = currentMatchup.totalVotes + 1;
    const nextSideVotes =
      voteSide === 'left' ? currentMatchup.leftVotes + 1 : currentMatchup.rightVotes + 1;
    const projectedPercent = Math.max(0, Math.min(100, Math.round((nextSideVotes / nextTotalVotes) * 100)));
    const selectedCandidateName = voteSide === 'left' ? currentMatchup.leftName : currentMatchup.rightName;

    setVoteFeedback({
      candidateName: selectedCandidateName,
      percent: projectedPercent,
      phase: 'enter',
    });

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
        setTransitionMessage(`${result.winnerName} takes the matchup. Loading the next pairing...`);
      }

      const payload = await getCurrentNameVotingMatchup(DEFAULT_NAME_VOTING_SESSION_ID);

      if (!payload) {
        throw new Error('No name voting session found.');
      }

      const latestRound = payload.session.currentRound;
      const matchups = await getRoundNameVotingMatchups(DEFAULT_NAME_VOTING_SESSION_ID, latestRound);
      const openMatchups = matchups.filter((matchup) => matchup.status === 'open');

      let nextMatchup: NameVotingMatchupWithId | null = openMatchups[0] ?? null;
      for (const openMatchup of openMatchups) {
        const hasVoted = await hasUserVotedForMatchup(DEFAULT_NAME_VOTING_SESSION_ID, openMatchup.id, uid);

        if (!hasVoted) {
          nextMatchup = openMatchup;
          break;
        }

        nextMatchup = null;
      }

      setCurrentRound(latestRound);
      setRoundMatchups(matchups);
      setCurrentMatchup(nextMatchup);
      setSessionStatus(payload.session.status);
      setFinalWinnerName(payload.session.finalWinnerName ?? null);

      if (nextMatchup) {
        setTransitionMessage(null);
        setHasVotedCurrentMatchup(false);
      } else {
        setTransitionMessage('You have voted on every open matchup this round. Waiting for other votes...');
      }

      setVoteFeedback((previous) => (previous ? { ...previous, phase: 'exit' } : previous));
      await new Promise((resolve) => {
        setTimeout(resolve, VOTE_MODAL_EXIT_MS);
      });
      setVoteFeedback(null);
    } catch (error) {
      setVoteFeedback(null);
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

  if (!currentMatchup && roundMatchups.length === 0) {
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
            Round <strong>{currentRound}</strong>
            {currentMatchup ? (
              <>
                {' '}• Matchup <strong>{currentMatchup.id}</strong>
              </>
            ) : null}
          </p>

          {currentMatchup ? (
            <>
              <div className="name-vote-candidates" role="group" aria-label="Current matchup">
                <article className="name-vote-candidate">
                  <span className="name-vote-candidate-name">{currentMatchup.leftName}</span>
                  <span className="name-vote-score-chip">{currentMatchup.leftVotes}</span>
                </article>
                <span className="name-vote-versus" aria-hidden="true">VS</span>
                <article className="name-vote-candidate">
                  <span className="name-vote-candidate-name">{currentMatchup.rightName}</span>
                  <span className="name-vote-score-chip">{currentMatchup.rightVotes}</span>
                </article>
              </div>

              <div className="name-vote-actions">
                <button
                  className="form-button-full-width"
                  type="button"
                  disabled={votingLocked}
                  onClick={() => void submitVote('left')}
                >
                  {`Vote ${currentMatchup.leftName}`}
                </button>
                <button
                  className="form-button-full-width"
                  type="button"
                  disabled={votingLocked}
                  onClick={() => void submitVote('right')}
                >
                  {`Vote ${currentMatchup.rightName}`}
                </button>
              </div>

              <p className="name-vote-progress">{progressLabel}</p>
            </>
          ) : null}

          {!currentMatchup ? (
            <div className="name-vote-overview" role="status" aria-live="polite">
              <h3 className="leaderboard-title">Round {currentRound} Bracket Overview</h3>
              <section className="name-vote-overview-summary" aria-label="Round progress">
                <div className="name-vote-overview-summary-row">
                  <p className="name-vote-overview-summary-progress">
                    {matchupSummary.closedMatchups} of {matchupSummary.totalMatchups} matchups closed
                  </p>
                  <p className="name-vote-overview-summary-percent">
                    {matchupSummary.completionPercent}% complete
                  </p>
                </div>
                <div className="name-vote-overview-progress-track" aria-hidden="true">
                  <div
                    className="name-vote-overview-progress-fill"
                    style={{ width: `${matchupSummary.completionPercent}%` }}
                  />
                </div>
                <p className="name-vote-overview-summary-meta">
                  {matchupSummary.openMatchups} open matchup
                  {matchupSummary.openMatchups === 1 ? '' : 's'} remaining
                </p>
              </section>
              <ul className="name-vote-overview-list">
                {roundMatchups.map((matchup) => (
                  <li
                    key={matchup.id}
                    className={`name-vote-overview-item ${
                      matchup.status === 'closed'
                        ? 'name-vote-overview-item--closed'
                        : 'name-vote-overview-item--open'
                    }`}
                  >
                    <header className="name-vote-overview-item-header">
                      <span className="name-vote-overview-item-label">Matchup {matchup.id}</span>
                    </header>

                    <div className="name-vote-overview-item-body">
                      <article
                        className={`name-vote-overview-candidate ${
                          matchup.status === 'closed' && matchup.winnerName === matchup.leftName
                            ? 'name-vote-overview-candidate--winner'
                            : ''
                        }`}
                      >
                        <span className="name-vote-overview-candidate-name">{matchup.leftName}</span>
                        <span className="name-vote-overview-candidate-votes">{matchup.leftVotes} votes</span>
                      </article>
                      <article
                        className={`name-vote-overview-candidate ${
                          matchup.status === 'closed' && matchup.winnerName === matchup.rightName
                            ? 'name-vote-overview-candidate--winner'
                            : ''
                        }`}
                      >
                        <span className="name-vote-overview-candidate-name">{matchup.rightName}</span>
                        <span className="name-vote-overview-candidate-votes">{matchup.rightVotes} votes</span>
                      </article>
                    </div>

                    <footer className="name-vote-overview-item-footer">
                      <span
                        className={`name-vote-overview-status-badge ${
                          matchup.status === 'closed'
                            ? 'name-vote-overview-status-badge--closed'
                            : 'name-vote-overview-status-badge--open'
                        }`}
                      >
                        {matchup.status === 'closed' ? 'Closed' : 'Open'}
                      </span>
                      {matchup.status === 'closed' && matchup.winnerName ? (
                        <strong className="name-vote-overview-winner-chip">
                          Winner: {matchup.winnerName}
                        </strong>
                      ) : null}
                    </footer>
                  </li>
                ))}
              </ul>
              {sessionStatus === 'complete' && finalWinnerName ? (
                <p className="notice">Tournament complete. Winner: {finalWinnerName}</p>
              ) : (
                <p className="name-vote-helper">Waiting for the rest of the round votes to finish.</p>
              )}
            </div>
          ) : null}

          {transitionMessage ? (
            <p className="notice name-vote-transition">{transitionMessage}</p>
          ) : !currentMatchup ? (
            <p className="name-vote-helper">You are caught up for this round.</p>
          ) : hasVotedCurrentMatchup ? (
            <p className="name-vote-helper">You already voted for this matchup.</p>
          ) : (
            <p className="name-vote-helper">Cast your vote to move this matchup forward.</p>
          )}
        </section>
      </div>
      {voteFeedback ? (
        <div
          className={`name-vote-feedback-modal name-vote-feedback-modal--${voteFeedback.phase}`}
          role="status"
          aria-live="assertive"
          aria-atomic="true"
        >
          <div className="name-vote-feedback-panel">
            <p className="name-vote-feedback-title">Vote cast for {voteFeedback.candidateName}</p>
            <div
              className="name-vote-feedback-water-circle"
              style={{ '--vote-fill-level': `${voteFeedback.percent}%` } as CSSProperties}
              aria-hidden="true"
            >
              <div className="name-vote-feedback-water-layer" />
              <div className="name-vote-feedback-water-wave" />
              <div className="name-vote-feedback-water-wave name-vote-feedback-water-wave--alt" />
              <span className="name-vote-feedback-percent">{voteFeedback.percent}%</span>
            </div>
            <p className="name-vote-feedback-caption">Share of votes in this matchup</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
