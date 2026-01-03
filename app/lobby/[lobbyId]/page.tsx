import LobbyDetail from "../../../components/LobbyDetail";

type LobbyPageProps = {
  params: {
    lobbyId: string;
  };
};

export default function LobbyPage({ params }: LobbyPageProps) {
  return <LobbyDetail lobbyId={params.lobbyId} />;
}
