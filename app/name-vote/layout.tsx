import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Name Vote | Skyjo Online',
  description: 'Vote on names for Skyjo Online.',
  openGraph: {
    title: 'Name Vote | Skyjo Online',
    description: 'Vote on names for Skyjo Online.',
    images: ['/images/skyjo-lobby-bg.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Name Vote | Skyjo Online',
    description: 'Vote on names for Skyjo Online.',
    images: ['/images/skyjo-lobby-bg.png'],
  },
};

export default function NameVoteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
