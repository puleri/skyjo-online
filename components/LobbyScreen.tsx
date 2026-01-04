import CreateLobbyForm from "./CreateLobbyForm";
import LobbyList from "./LobbyList";
import UsernameForm from "./UsernameForm";

export default function LobbyScreen() {
  return (
    <main>
      <section>
        <h1>Skyjo Online</h1>
        <p>
          Welcome to Skyjo online! I love you. Create or join a lobby to start.
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
