import CreateLobbyForm from "./CreateLobbyForm";
import LobbyList from "./LobbyList";
import UsernameForm from "./UsernameForm";

export default function LobbyScreen() {
  return (
    <main>
      <section>
        <h1>Skyjo Online</h1>
        <p>
          Welcome! This starter page connects to Firebase Firestore using real-time
          updates. Create a lobby to confirm your Firestore project is wired up,
          and watch the list update instantly for everyone connected.
        </p>
      </section>

      <section>
        <h2>Choose your username</h2>
        <UsernameForm />
      </section>

      <section>
        <h2>Create a lobby</h2>
        <CreateLobbyForm />
      </section>

      <section>
        <h2>Live lobbies</h2>
        <LobbyList />
      </section>
    </main>
  );
}
