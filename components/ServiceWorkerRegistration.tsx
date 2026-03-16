"use client";

import { useEffect } from "react";

const WORKBOX_WINDOW_URL =
  "https://storage.googleapis.com/workbox-cdn/releases/7.1.0/workbox-window.prod.mjs";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (!("serviceWorker" in navigator)) {
      return;
    }

    let mounted = true;

    const register = async () => {
      const { Workbox } = await import(
        /* webpackIgnore: true */ WORKBOX_WINDOW_URL
      );

      if (!mounted) {
        return;
      }

      const wb = new Workbox("/sw.js");

      wb.addEventListener("waiting", () => {
        wb.messageSkipWaiting();
      });

      wb.addEventListener("controlling", () => {
        window.location.reload();
      });

      await wb.register();
    };

    register().catch((error) => {
      console.error("Service worker registration failed", error);
    });

    return () => {
      mounted = false;
    };
  }, []);

  return null;
}
