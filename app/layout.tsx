import "./globals.css";

import type { Metadata, Viewport } from "next";
import Script from "next/script";
import ThemeSync from "../components/ThemeSync";
import ServiceWorkerRegistration from "../components/ServiceWorkerRegistration";
import LobbyProvider from "../components/LobbyProvider";
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

const themeBootstrapScript = `(() => {
  try {
    const darkMode = window.localStorage.getItem("misty-dark-mode");
    if (darkMode === "true") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  } catch {
    document.documentElement.removeAttribute("data-theme");
  }
})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrapScript}
        </Script>
        <SpeedInsights />
        <LobbyProvider><ThemeSync>{children}</ThemeSync></LobbyProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
