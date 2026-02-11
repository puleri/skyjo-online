import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { db } from './firebase';
import { NAME_VOTING_COLLECTION, type NameVotingMatchup, type NameVotingSession } from './nameVoting';

export type NameVoteSide = 'left' | 'right';

type MatchupWithId = NameVotingMatchup & { id: string };

const assertCondition = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const getWinnerName = (
  matchup: Pick<NameVotingMatchup, 'leftName' | 'rightName'>,
  leftVotes: number,
  rightVotes: number
) => (leftVotes >= rightVotes ? matchup.leftName : matchup.rightName);

const createNextRoundMatchup = (
  leftName: string,
  rightName: string | null,
  voteTarget: number
) => {
  const hasBye = rightName === null;

  return {
    leftName,
    rightName: rightName ?? '(BYE)',
    leftVotes: 0,
    rightVotes: 0,
    totalVotes: 0,
    voteTarget: hasBye ? 0 : voteTarget,
    status: hasBye ? 'closed' : 'open',
    winnerName: hasBye ? leftName : null,
    closedAt: hasBye ? serverTimestamp() : null,
  };
};

async function advanceNameVotingSessionIfRoundClosed(
  sessionId: string,
  roundNumber: number,
  voteTarget: number
) {
  const sessionRef = doc(db, NAME_VOTING_COLLECTION, sessionId);
  const matchupsCollectionRef = collection(sessionRef, 'matchups');
  const roundsCollectionRef = collection(sessionRef, 'rounds');

  const currentRoundMatchupsQuery = query(
    matchupsCollectionRef,
    where('roundNumber', '==', roundNumber),
    orderBy('leftName', 'asc')
  );
  const currentRoundMatchupsSnapshot = await getDocs(currentRoundMatchupsQuery);
  const matchupIds = currentRoundMatchupsSnapshot.docs.map((snapshot) => snapshot.id);

  if (matchupIds.length === 0) {
    return;
  }

  await runTransaction(db, async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionRef);
    assertCondition(sessionSnapshot.exists(), 'Name vote session not found.');

    const session = sessionSnapshot.data() as NameVotingSession;

    if (session.status === 'complete' || session.currentRound !== roundNumber) {
      return;
    }

    const currentRoundMatchups: MatchupWithId[] = [];
    for (const currentMatchupId of matchupIds) {
      const currentMatchupRef = doc(matchupsCollectionRef, currentMatchupId);
      const currentMatchupSnapshot = await transaction.get(currentMatchupRef);

      if (!currentMatchupSnapshot.exists()) {
        continue;
      }

      currentRoundMatchups.push({
        id: currentMatchupSnapshot.id,
        ...(currentMatchupSnapshot.data() as NameVotingMatchup),
      });
    }

    currentRoundMatchups.sort((left, right) => left.id.localeCompare(right.id));

    const allMatchupsClosed = currentRoundMatchups.every(
      (currentMatchup) => currentMatchup.status === 'closed'
    );

    if (!allMatchupsClosed) {
      return;
    }

    const winnerNames = currentRoundMatchups.map((currentMatchup) => currentMatchup.winnerName);
    const resolvedWinnerNames = winnerNames.filter((name): name is string => Boolean(name));
    assertCondition(
      resolvedWinnerNames.length === winnerNames.length,
      'Every closed matchup must have a winner.'
    );

    const currentRoundRef = doc(roundsCollectionRef, `round-${roundNumber}`);
    transaction.set(
      currentRoundRef,
      {
        roundNumber,
        status: 'complete',
      },
      { merge: true }
    );

    if (resolvedWinnerNames.length === 1) {
      transaction.set(
        sessionRef,
        {
          status: 'complete',
          finalWinnerName: resolvedWinnerNames[0],
          metadata: {
            byePolicy: 'auto-advance',
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    const nextRoundNumber = roundNumber + 1;
    const nextRoundRef = doc(roundsCollectionRef, `round-${nextRoundNumber}`);

    transaction.set(
      nextRoundRef,
      {
        roundNumber: nextRoundNumber,
        status: 'active',
      },
      { merge: true }
    );

    for (let index = 0; index < resolvedWinnerNames.length; index += 2) {
      const leftName = resolvedWinnerNames[index];
      const rightName = resolvedWinnerNames[index + 1] ?? null;
      const nextMatchupRef = doc(matchupsCollectionRef, `round-${nextRoundNumber}-matchup-${index / 2 + 1}`);

      transaction.set(nextMatchupRef, {
        roundNumber: nextRoundNumber,
        ...createNextRoundMatchup(leftName, rightName, voteTarget),
      });
    }

    transaction.set(
      sessionRef,
      {
        currentRound: nextRoundNumber,
        status: 'active',
        finalWinnerName: null,
        metadata: {
          byePolicy: 'auto-advance',
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}

export async function submitNameVote(
  sessionId: string,
  matchupId: string,
  voteSide: NameVoteSide
) {
  const sessionRef = doc(db, NAME_VOTING_COLLECTION, sessionId);
  const matchupRef = doc(db, NAME_VOTING_COLLECTION, sessionId, 'matchups', matchupId);

  const result = await runTransaction(db, async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionRef);
    assertCondition(sessionSnapshot.exists(), 'Name vote session not found.');
    const session = sessionSnapshot.data() as NameVotingSession;

    const matchupSnapshot = await transaction.get(matchupRef);
    assertCondition(matchupSnapshot.exists(), 'Name vote matchup not found.');

    const matchup = matchupSnapshot.data() as NameVotingMatchup;

    assertCondition(matchup.roundNumber === session.currentRound, 'Name vote matchup is not in current round.');
    assertCondition(matchup.status === 'open', 'Name vote matchup is not open.');
    assertCondition(
      matchup.totalVotes < matchup.voteTarget,
      'Name vote matchup already reached its vote target.'
    );

    const nextLeftVotes = voteSide === 'left' ? matchup.leftVotes + 1 : matchup.leftVotes;
    const nextRightVotes = voteSide === 'right' ? matchup.rightVotes + 1 : matchup.rightVotes;
    const nextTotalVotes = nextLeftVotes + nextRightVotes;

    const updates: {
      leftVotes: number;
      rightVotes: number;
      totalVotes: number;
      status?: NameVotingMatchup['status'];
      winnerName?: string;
      closedAt?: ReturnType<typeof serverTimestamp>;
    } = {
      leftVotes: nextLeftVotes,
      rightVotes: nextRightVotes,
      totalVotes: nextTotalVotes,
    };

    if (nextTotalVotes === matchup.voteTarget) {
      updates.status = 'closed';
      updates.winnerName = getWinnerName(matchup, nextLeftVotes, nextRightVotes);
      updates.closedAt = serverTimestamp();
    }

    transaction.update(matchupRef, updates);

    return {
      matchupId,
      leftVotes: nextLeftVotes,
      rightVotes: nextRightVotes,
      totalVotes: nextTotalVotes,
      status: updates.status ?? matchup.status,
      winnerName: updates.winnerName ?? matchup.winnerName,
      justClosed: updates.status === 'closed',
      roundNumber: matchup.roundNumber,
      voteTarget: matchup.voteTarget,
    };
  });

  if (result.justClosed) {
    await advanceNameVotingSessionIfRoundClosed(sessionId, result.roundNumber, result.voteTarget);
  }

  return result;
}
