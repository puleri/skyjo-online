import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Name Bracket Voting',
  description: 'Help pick the final name. Vote head-to-head in a tournament bracket.',
  openGraph: {
    title: 'Name Bracket Voting',
    description: 'Help pick the final name. Vote head-to-head in a tournament bracket.',
    images: ['/images/misty-lobby-bg.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Name Bracket Voting',
    description: 'Help pick the final name. Vote head-to-head in a tournament bracket.',
    images: ['/images/misty-lobby-bg.png'],
  },
};

export default function NameVoteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
