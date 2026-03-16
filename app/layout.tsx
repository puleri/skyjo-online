import "./globals.css";

import type { Metadata, Viewport } from "next";
import ThemeSync from "../components/ThemeSync";
import ServiceWorkerRegistration from "../components/ServiceWorkerRegistration";
import { SpeedInsights } from "@vercel/speed-insights/next";

const APP_NAME = "Misty Match";
const APP_SHORT_NAME = "Misty";
const THEME_COLOR = "#5f7a6a";
const BACKGROUND_COLOR = "#f5eee9";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_SHORT_NAME}`,
  },
  applicationName: APP_NAME,
  description: "A simple and mildly fun game for the whole family",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: APP_SHORT_NAME,
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: BACKGROUND_COLOR }}>
        <SpeedInsights />
        <ThemeSync>{children}</ThemeSync>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
