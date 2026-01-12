'use client';
import { useEffect, useState } from "react";
import CreateLobbyForm from "./CreateLobbyForm";
import LobbyList from "./LobbyList";
import UsernameForm from "./UsernameForm";

const darkModeStorageKey = "skyjo-dark-mode";
const firstTimeTipsStorageKey = "skyjo-first-time-tips";
const heroBannerLight = "/images/skyjo-hero-banner.png";
const heroBannerDark = "/images/skyjo-hero-banner-darkmode.png";

function getInitialDarkModePreference() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(darkModeStorageKey) === "true";
}

export default function LobbyScreen() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showFirstTimeTips, setShowFirstTimeTips] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(getInitialDarkModePreference);
  const heroBannerSrc = isDarkMode ? heroBannerDark : heroBannerLight;

  useEffect(() => {
    const storedTipsPreference = window.localStorage.getItem(firstTimeTipsStorageKey);
    if (storedTipsPreference !== null) {
      setShowFirstTimeTips(storedTipsPreference === "true");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(firstTimeTipsStorageKey, String(showFirstTimeTips));
  }, [showFirstTimeTips]);

  useEffect(() => {
    window.localStorage.setItem(darkModeStorageKey, String(isDarkMode));
    if (isDarkMode) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [isDarkMode]);

  return (
    <main>
      <img className="welcome-div" src={heroBannerSrc} alt="Skyjo Hero Banner" />

      <div className="container">
        <div className="flex-space-between">
          <h2 className="sage-eyebrow-text">GETTING STARTED</h2>
          {/* when this button is clicked, it opens the rules image in another window */}
          <div className="menu-action-buttons">
            <button
              type="button"
              className="menu-action-button"
              aria-label="Open game settings"
              onClick={() => setIsSettingsOpen(true)}
            >
              <img className="settings-icon" src="/settings-icon.svg" alt="Settings icon" />
            </button>
            <button
              type="button"
              className="menu-action-button"
              aria-label="Open game rules"
              onClick={() => {
                window.open("/rules.png", "_blank");
              }}
            >
              <img
                className="question-mark-icon"
                src="/question-mark-icon.svg"
                alt="Skyjo Instructions Menu Icon"
              />
            </button>
          </div>
        </div>
        {isSettingsOpen ? (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="main-menu-settings-title"
            onClick={() => setIsSettingsOpen(false)}
          >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <h2 id="main-menu-settings-title">Settings</h2>
              <p>Update your preferences.</p>
              <div className="modal__option">
                <label className="modal__option-label modal__option-toggle">
                  <span>First time tips</span>
                  <span className="toggle">
                    <input
                      className="toggle__input"
                      type="checkbox"
                      checked={showFirstTimeTips}
                      onChange={(event) => setShowFirstTimeTips(event.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                  </span>
                </label>
                <p className="modal__option-help">
                  Show the quick hints about revealing, replacing, and swapping cards.
                </p>
              </div>
              <div className="modal__option">
                <label className="modal__option-label modal__option-toggle">
                  <span>Dark mode</span>
                  <span className="toggle">
                    <input
                      className="toggle__input"
                      type="checkbox"
                      checked={isDarkMode}
                      onChange={(event) => setIsDarkMode(event.target.checked)}
                    />
                    <span className="toggle__track" aria-hidden="true" />
                  </span>
                </label>
                <p className="modal__option-help">Switch the interface to the dark theme.</p>
              </div>
              <div className="modal__actions">
                <button type="button" onClick={() => setIsSettingsOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <section>
          <UsernameForm />
        </section>

        <section className="form-card">
          <CreateLobbyForm />
        </section>

        <div className="lobby-list-section">
          <h2 className="charcoal-eyebrow-text">LOBBIES</h2>
          <LobbyList />
        </div>

      </div>
    </main>
  );
}
