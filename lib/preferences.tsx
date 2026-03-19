"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const preferenceDefaults = {
  darkMode: false,
  cardSounds: true,
  backgroundMusic: false,
  snow: false,
  firstTimeTips: false,
  autoFollow: true,
} as const;

export type PreferenceName = keyof typeof preferenceDefaults;

export const preferenceStorageKeys: Record<PreferenceName, string> = {
  darkMode: "misty-dark-mode",
  cardSounds: "misty-card-sounds",
  backgroundMusic: "misty-background-music",
  snow: "misty-snow",
  firstTimeTips: "misty-first-time-tips",
  autoFollow: "misty-auto-follow",
};

export type Preferences = {
  [key in PreferenceName]: boolean;
};

type PreferencesContextValue = {
  preferences: Preferences;
  setPreference: (name: PreferenceName, value: boolean) => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readStoredPreference(name: PreferenceName): boolean {
  if (typeof window === "undefined") {
    return preferenceDefaults[name];
  }

  const storedValue = window.localStorage.getItem(preferenceStorageKeys[name]);
  if (storedValue === null) {
    return preferenceDefaults[name];
  }

  return storedValue === "true";
}

function getInitialPreferences(): Preferences {
  return {
    darkMode: readStoredPreference("darkMode"),
    cardSounds: readStoredPreference("cardSounds"),
    backgroundMusic: readStoredPreference("backgroundMusic"),
    snow: readStoredPreference("snow"),
    firstTimeTips: readStoredPreference("firstTimeTips"),
    autoFollow: readStoredPreference("autoFollow"),
  };
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(getInitialPreferences);

  const setPreference = useCallback((name: PreferenceName, value: boolean) => {
    setPreferences((current) => {
      if (current[name] === value) {
        return current;
      }
      return { ...current, [name]: value };
    });

    if (typeof window !== "undefined") {
      window.localStorage.setItem(preferenceStorageKeys[name], String(value));
    }
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!event.key) {
        return;
      }

      const changedPreference = (Object.keys(preferenceStorageKeys) as PreferenceName[]).find(
        (name) => preferenceStorageKeys[name] === event.key
      );

      if (!changedPreference) {
        return;
      }

      const nextValue = event.newValue === null
        ? preferenceDefaults[changedPreference]
        : event.newValue === "true";

      setPreferences((current) => {
        if (current[changedPreference] === nextValue) {
          return current;
        }
        return { ...current, [changedPreference]: nextValue };
      });
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = useMemo(
    () => ({
      preferences,
      setPreference,
    }),
    [preferences, setPreference]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);

  if (!context) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }

  return context;
}
