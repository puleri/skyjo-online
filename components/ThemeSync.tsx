"use client";

import { useEffect, type ReactNode } from "react";
import { PreferencesProvider, usePreferences } from "../lib/preferences";

function ThemePreferenceSync() {
  const {
    preferences: { darkMode },
  } = usePreferences();

  useEffect(() => {
    if (darkMode) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [darkMode]);

  return null;
}

export default function ThemeSync({ children }: { children: ReactNode }) {
  return (
    <PreferencesProvider>
      <ThemePreferenceSync />
      {children}
    </PreferencesProvider>
  );
}
