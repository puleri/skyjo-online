import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';

import { db } from './firebase';

export const NAME_VOTING_COLLECTION = 'nameVotingSessions';
export const NAME_VOTING_VOTE_TARGET = 7;

const RAW_SEED_NAMES = [
  'Canopy',
  'Stillwild',
  'Clearing',
  'Ground Tom',
  'Earth Sue',
  'Water Em',
  'Fire Mae',
  'Space Matt',
  'Sky Nate',
  'stay low',
  'oopsie',
  'Grassfed',
  'Meku',
  'Opto',
  'Popjo',
  'Tacta',
  'Kairo',
  'Spike City',
  'Unki',
  'Yuki',
  'Kuru',
  'Suko',
  'This or That',
  'Moonbeam',
  'Starry Starry Night',
  'Trade or Reveal?',
  'StarNite',
  'A Card Game',
  'Cardgame',
  'Carol',
  'Pulermo',
  'Weeping Willows'
];

export const canonicalSeedNames = RAW_SEED_NAMES.map((name) =>
  name
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

export type NameVotingSessionStatus = 'setup' | 'active' | 'complete';
export type NameVotingRoundStatus = 'active' | 'complete';
export type NameVotingMatchupStatus = 'open' | 'closed';

export type NameVotingSession = {
  status: NameVotingSessionStatus;
  currentRound: number;
  seedNames: string[];
  finalWinnerName?: string | null;
  metadata?: {
    byePolicy?: 'auto-advance';
  };
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

export type NameVotingRound = {
  roundNumber: number;
  status: NameVotingRoundStatus;
};

export type NameVotingMatchup = {
  roundNumber: number;
  leftName: string;
  rightName: string;
  leftVotes: number;
  rightVotes: number;
  totalVotes: number;
  voteTarget: number;
  status: NameVotingMatchupStatus;
  winnerName: string | null;
  closedAt: Timestamp | null;
};

export type NameVotingMatchupWithId = NameVotingMatchup & { id: string };

export async function ensureNameVotingSession(sessionId: string) {
  const sessionRef = doc(db, NAME_VOTING_COLLECTION, sessionId);
  const sessionSnapshot = await getDoc(sessionRef);

  if (sessionSnapshot.exists()) {
    return;
  }

  const batch = writeBatch(db);
  const now = serverTimestamp();

  batch.set(sessionRef, {
    status: 'active',
    currentRound: 1,
    seedNames: canonicalSeedNames,
    finalWinnerName: null,
    metadata: {
      byePolicy: 'auto-advance',
    },
    createdAt: now,
    updatedAt: now,
  } satisfies Omit<NameVotingSession, 'createdAt' | 'updatedAt'> & {
    createdAt: ReturnType<typeof serverTimestamp>;
    updatedAt: ReturnType<typeof serverTimestamp>;
  });

  const roundRef = doc(collection(sessionRef, 'rounds'), 'round-1');
  batch.set(roundRef, {
    roundNumber: 1,
    status: 'active',
  } satisfies NameVotingRound);

  for (let index = 0; index < canonicalSeedNames.length; index += 2) {
    const leftName = canonicalSeedNames[index];
    const rightName = canonicalSeedNames[index + 1];

    if (!leftName || !rightName) {
      continue;
    }

    const matchupRef = doc(collection(sessionRef, 'matchups'), `round-1-matchup-${index / 2 + 1}`);
    batch.set(matchupRef, {
      roundNumber: 1,
      leftName,
      rightName,
      leftVotes: 0,
      rightVotes: 0,
      totalVotes: 0,
      voteTarget: NAME_VOTING_VOTE_TARGET,
      status: 'open',
      winnerName: null,
      closedAt: null,
    } satisfies NameVotingMatchup);
  }

  await batch.commit();
}

export async function getCurrentNameVotingMatchup(sessionId: string) {
  const sessionRef = doc(db, NAME_VOTING_COLLECTION, sessionId);
  const sessionSnapshot = await getDoc(sessionRef);

  if (!sessionSnapshot.exists()) {
    return null;
  }

  const sessionData = sessionSnapshot.data() as NameVotingSession;
  const matchupsRef = collection(sessionRef, 'matchups');
  const matchupsQuery = query(
    matchupsRef,
    where('roundNumber', '==', sessionData.currentRound),
    where('status', '==', 'open'),
    orderBy('leftName', 'asc'),
    limit(1)
  );
  const matchupSnapshots = await getDocs(matchupsQuery);
  const matchup = matchupSnapshots.docs[0];

  if (!matchup) {
    return {
      session: sessionData,
      matchup: null,
    };
  }

  return {
    session: sessionData,
    matchup: {
      id: matchup.id,
      ...(matchup.data() as NameVotingMatchup),
    },
  };
}

export async function getRoundNameVotingMatchups(sessionId: string, roundNumber: number) {
  const sessionRef = doc(db, NAME_VOTING_COLLECTION, sessionId);
  const matchupsRef = collection(sessionRef, 'matchups');
  const matchupsQuery = query(
    matchupsRef,
    where('roundNumber', '==', roundNumber),
    orderBy('leftName', 'asc')
  );
  const snapshots = await getDocs(matchupsQuery);

  return snapshots.docs.map((matchup) => ({
    id: matchup.id,
    ...(matchup.data() as NameVotingMatchup),
  }));
}

export function getNameVoteProgressLabel(totalVotes: number, voteTarget: number) {
  return `${totalVotes} / ${voteTarget} votes`;
}
