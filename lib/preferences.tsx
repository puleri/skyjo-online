"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getAuth, onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { app, db, isFirebaseConfigured } from "./firebase";

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

function writePreferencesToLocalStorage(preferences: Preferences) {
  if (typeof window === "undefined") {
    return;
  }

  for (const name of Object.keys(preferenceStorageKeys) as PreferenceName[]) {
    window.localStorage.setItem(preferenceStorageKeys[name], String(preferences[name]));
  }
}

function normalizePreferences(preferences: Partial<Preferences> | null | undefined): Preferences {
  return {
    darkMode: typeof preferences?.darkMode === "boolean" ? preferences.darkMode : preferenceDefaults.darkMode,
    cardSounds:
      typeof preferences?.cardSounds === "boolean"
        ? preferences.cardSounds
        : preferenceDefaults.cardSounds,
    backgroundMusic:
      typeof preferences?.backgroundMusic === "boolean"
        ? preferences.backgroundMusic
        : preferenceDefaults.backgroundMusic,
    snow: typeof preferences?.snow === "boolean" ? preferences.snow : preferenceDefaults.snow,
    firstTimeTips:
      typeof preferences?.firstTimeTips === "boolean"
        ? preferences.firstTimeTips
        : preferenceDefaults.firstTimeTips,
    autoFollow:
      typeof preferences?.autoFollow === "boolean"
        ? preferences.autoFollow
        : preferenceDefaults.autoFollow,
  };
}

async function loadFirestorePreferences(user: User): Promise<Preferences | null> {
  const userSnapshot = await getDoc(doc(db, "users", user.uid));
  if (!userSnapshot.exists()) {
    return null;
  }

  const profile = userSnapshot.data();
  if (!profile.settingsPreferences || typeof profile.settingsPreferences !== "object") {
    return null;
  }

  return normalizePreferences(profile.settingsPreferences as Partial<Preferences>);
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(getInitialPreferences);
  const [activeUser, setActiveUser] = useState<User | null>(null);
  const preferencesRef = useRef(preferences);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const setPreference = useCallback((name: PreferenceName, value: boolean) => {
    const nextPreferences = {
      ...preferencesRef.current,
      [name]: value,
    };

    setPreferences((current) => {
      if (current[name] === value) {
        return current;
      }

      return nextPreferences;
    });

    writePreferencesToLocalStorage(nextPreferences);

    if (!isFirebaseConfigured || !activeUser || activeUser.isAnonymous) {
      return;
    }

    void setDoc(
      doc(db, "users", activeUser.uid),
      {
        settingsPreferences: nextPreferences,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((error: unknown) => {
      console.error("[preferences] Failed to sync preference", error);
    });
  }, [activeUser]);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }

    let isMounted = true;
    let loadRequestId = 0;
    const auth = getAuth(app);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      loadRequestId += 1;
      const currentLoadRequestId = loadRequestId;
      setActiveUser(user ?? null);

      if (!user || user.isAnonymous) {
        if (!isMounted) {
          return;
        }

        const storedPreferences = getInitialPreferences();
        setPreferences(storedPreferences);
        writePreferencesToLocalStorage(storedPreferences);
        return;
      }

      void loadFirestorePreferences(user)
        .then((firestorePreferences) => {
          if (!isMounted || currentLoadRequestId !== loadRequestId) {
            return;
          }

          const nextPreferences = firestorePreferences ?? getInitialPreferences();
          setPreferences(nextPreferences);
          writePreferencesToLocalStorage(nextPreferences);
        })
        .catch((error: unknown) => {
          if (!isMounted || currentLoadRequestId !== loadRequestId) {
            return;
          }

          console.error("[preferences] Failed to load Firestore preferences", error);
          const storedPreferences = getInitialPreferences();
          setPreferences(storedPreferences);
          writePreferencesToLocalStorage(storedPreferences);
        });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
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
