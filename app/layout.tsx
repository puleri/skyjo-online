import "./globals.css";

import type { Metadata, Viewport } from "next";
import ThemeSync from "../components/ThemeSync";
import ServiceWorkerRegistration from "../components/ServiceWorkerRegistration";
import { SpeedInsights } from "@vercel/speed-insights/next";

const APP_NAME = "Misty";
const APP_SHORT_NAME = "Misty";
const THEME_COLOR = "#5f7a6a";
const MANIFEST_PATH = "/manifest.json";
const APP_ICON_192 = "/web-app-manifest-192x192.png";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_SHORT_NAME}`,
  },
  applicationName: APP_NAME,
  description: "A simple and mildly fun game for the whole family",
  manifest: MANIFEST_PATH,
  icons: {
    icon: [
      { url: APP_ICON_192, sizes: "192x192", type: "image/png" },
      { url: "/web-app-manifest-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: APP_ICON_192, sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: APP_SHORT_NAME,
    statusBarStyle: "default",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SpeedInsights />
        <ThemeSync>{children}</ThemeSync>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
