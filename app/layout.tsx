import "./globals.css";

import type { Metadata } from "next";
import ThemeSync from "../components/ThemeSync";




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
      <body>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
