import "./globals.css";

import type { Metadata } from "next";
import ThemeSync from "../components/ThemeSync";
import { SpeedInsights } from "@vercel/speed-insights/next"




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

      <body>
        <ThemeSync>{children}</ThemeSync>
      </body>
    </html>
  );
}
