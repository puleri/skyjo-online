"use client";

import Link from "next/link";
import { usePreferences } from "../lib/preferences";
import SnowfallLayer from "./SnowfallLayer";
import UsernameForm from "./UsernameForm";

export default function UnauthenticatedHome() {
  const { preferences } = usePreferences();
  const { snow: isSnowEnabled } = preferences;

  return (
    <main>
      {isSnowEnabled ? <SnowfallLayer height={"180%"} /> : null}
      <img
        className="welcome-div welcome-div-light"
        src="/images/misty-hero-banner.png"
        alt=""
      />
      <img
        className="welcome-div welcome-div-dark"
        src="/images/misty-hero-banner-darkmode.png"
        alt=""
      />

      <div className="container">
        <div className="flex-space-between">
          <h2 className="sage-eyebrow-text">GETTING STARTED</h2>
          <Link
            href="/rules"
            className="menu-action-button"
            aria-label="Open game rules"
          >
            <img
              className="question-mark-icon"
              src="/question-mark-icon.png"
              alt="Misty Instructions Menu Icon"
            />
          </Link>
        </div>
        <section>
          <UsernameForm />
        </section>
      </div>
    </main>
  );
}
