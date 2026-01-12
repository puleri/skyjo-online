"use client";

import { useEffect } from "react";

const darkModeStorageKey = "skyjo-dark-mode";

export default function ThemeSync() {
  useEffect(() => {
    const storedPreference = window.localStorage.getItem(darkModeStorageKey);
    if (storedPreference === "true") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== darkModeStorageKey) {
        return;
      }
      if (event.newValue === "true") {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return null;
}
