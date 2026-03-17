"use client";

import { Workbox } from "workbox-window";
import { useEffect, useRef, useState } from "react";

export default function ServiceWorkerRegistration() {
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [isUpdatePromptVisible, setIsUpdatePromptVisible] = useState(false);
  const [workboxInstance, setWorkboxInstance] = useState<Workbox | null>(null);
  const didRefreshRef = useRef(false);

  const handleApplyUpdate = () => {
    if (!workboxInstance) {
      return;
    }

    setIsUpdatePromptVisible(false);
    workboxInstance.messageSkipWaiting();
  };

  const handleDismissUpdate = () => {
    setIsUpdatePromptVisible(false);
  };

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
      setWorkboxInstance(wb);

      wb.addEventListener("waiting", () => {
        if (!navigator.serviceWorker.controller) {
          return;
        }

        setIsUpdateAvailable(true);
        setIsUpdatePromptVisible(true);
      });

      wb.addEventListener("controlling", () => {
        if (didRefreshRef.current) {
          return;
        }

        didRefreshRef.current = true;
        window.location.reload();
      });

      await wb.register();
    };

    register().catch((error) => {
      console.error("Service worker registration failed", error);
    });

    return () => {
      mounted = false;
      setWorkboxInstance(null);
    };
  }, []);

  return isUpdateAvailable && isUpdatePromptVisible ? (
    <div className="service-worker-update-toast" role="status" aria-live="polite">
      <span>Update available</span>
      <button
        type="button"
        className="service-worker-update-toast__button"
        onClick={handleApplyUpdate}
      >
        Update
      </button>
      <button
        type="button"
        className="service-worker-update-toast__button"
        onClick={handleDismissUpdate}
      >
        Later
      </button>
    </div>
  ) : null;
}
