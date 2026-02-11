import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';

import { db } from './firebase';
import { NAME_VOTING_COLLECTION, type NameVotingMatchup } from './nameVoting';

export type NameVoteSide = 'left' | 'right';

const assertCondition = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const getWinnerName = (matchup: Pick<NameVotingMatchup, 'leftName' | 'rightName'>, leftVotes: number, rightVotes: number) =>
  leftVotes >= rightVotes ? matchup.leftName : matchup.rightName;

export async function submitNameVote(
  sessionId: string,
  matchupId: string,
  voteSide: NameVoteSide
) {
  const matchupRef = doc(db, NAME_VOTING_COLLECTION, sessionId, 'matchups', matchupId);

  return runTransaction(db, async (transaction) => {
    const matchupSnapshot = await transaction.get(matchupRef);
    assertCondition(matchupSnapshot.exists(), 'Name vote matchup not found.');

    const matchup = matchupSnapshot.data() as NameVotingMatchup;

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
    };
  });
}
