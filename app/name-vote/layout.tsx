import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'It is name-time.',
  description: 'Pick the final name. Vote head-to-head in a tournament bracket.',
  openGraph: {
    title: 'It is name-time.',
    description: 'Pick the final name. Vote head-to-head in a tournament bracket.',
    images: ['/images/skyjo-lobby-bg.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'It is name-time.',
    description: 'Pick the final name. Vote head-to-head in a tournament bracket.',
    images: ['/images/skyjo-lobby-bg.png'],
  },
};

export default function NameVoteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
