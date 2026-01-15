import "./globals.css";

import type { Metadata } from "next";
import ThemeSync from "../components/ThemeSync";
import { SpeedInsights } from "@vercel/speed-insights/next"




export const metadata: Metadata = {
  title: "Skyjo Online",
  description: "Play Skyjo online with friends!",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <meta name="apple-mobile-web-app-title" content="Skyjo" />
      <SpeedInsights />

      <body>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
