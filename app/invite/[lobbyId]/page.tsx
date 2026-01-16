import InviteLobbyJoin from "../../../components/InviteLobbyJoin";

type InvitePageProps = {
  params: {
    lobbyId: string;
  };
};

export default function InvitePage({ params }: InvitePageProps) {
  return <InviteLobbyJoin lobbyId={params.lobbyId} />;
}
