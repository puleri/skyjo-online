import GameScreen from "../../../components/GameScreen";

type GamePageProps = {
  params: {
    gameId: string;
  };
};

export default function GamePage({ params }: GamePageProps) {
  return <GameScreen gameId={params.gameId} />;
}
