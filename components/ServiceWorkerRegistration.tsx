"use client";

import { Workbox } from "workbox-window";
import { useEffect } from "react";

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
