'use client';
import CreateLobbyForm from "./CreateLobbyForm";
import LobbyList from "./LobbyList";
import UsernameForm from "./UsernameForm";

export default function LobbyScreen() {
  return (
    <main>
      <img className="welcome-div" src="/images/skyjo-hero-banner.png" alt="Skyjo Hero Banner" />

      <div className="container">
        <div className="flex-space-between">
          <h2 className="sage-eyebrow-text">GETTING STARTED</h2>
          {/* when this button is clicked, it opens the rules image in another window */}

          <div
            onClick={() => {
              window.open("/rules.png", "_blank");
            }}

            className="question-mark-div">
            <img
              className="question-mark-icon"
              src="/question-mark-icon.svg"
              alt="Skyjo Instructions Menu Icon"
            />
          </div>
        </div>
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
