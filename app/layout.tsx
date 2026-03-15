import "./globals.css";

import type { Metadata } from "next";
import type { CSSProperties } from "react";
import ThemeSync from "../components/ThemeSync";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { cardTravelMs, drawPilePopMs, hoverLiftMs, standardEase } from "../lib/motion";




export const metadata: Metadata = {
  title: "Misty",
  description: "A simple and mildly fun game for the whole family",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <meta name="apple-mobile-web-app-title" content="Misty" />
      <SpeedInsights />

      <body
        style={{
          "--motion-draw-pop-ms": `${drawPilePopMs}ms`,
          "--motion-card-travel-ms": `${cardTravelMs}ms`,
          "--motion-ease-standard": standardEase,
          "--motion-hover-lift-ms": `${hoverLiftMs}ms`,
        } as CSSProperties}
      >
        <ThemeSync>{children}</ThemeSync>
      </body>
    </html>
  );
}
