import "./globals.css";

import type { Metadata } from "next";




export const metadata: Metadata = {
  title: "Skyjo Online",
  description: "Realtime Skyjo lobby management powered by Firebase.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
      <p className="legal-tiny">I do not own the rights to Skyjo; this is just a
          fan project made for learning purposes. If you enjoy this project, please
          consider buying the physical game online or from a game store near you</p>
    </html>
  );
}
