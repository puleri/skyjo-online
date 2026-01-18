import InviteLobbyJoin from "../../../components/InviteLobbyJoin";
import type { Metadata } from "next";

type InvitePageProps = {
  params: {
    lobbyId: string;
  };
};

const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "";

const buildLobbyDocumentUrl = (lobbyId: string) => {
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/lobbies/${encodeURIComponent(
    lobbyId
  )}`;
  return firebaseApiKey ? `${baseUrl}?key=${firebaseApiKey}` : baseUrl;
};

const fetchHostDisplayName = async (lobbyId: string): Promise<string | null> => {
  if (!firebaseProjectId) {
    return null;
  }

  try {
    const response = await fetch(buildLobbyDocumentUrl(lobbyId), {
      next: { revalidate: 30 },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as {
      fields?: { hostDisplayName?: { stringValue?: string } };
    };
    const hostName = data.fields?.hostDisplayName?.stringValue;
    return hostName && hostName.trim() ? hostName : null;
  } catch {
    return null;
  }
};

export async function generateMetadata({ params }: InvitePageProps): Promise<Metadata> {
  const hostName = (await fetchHostDisplayName(params.lobbyId)) ?? "A player";
  const message = `${hostName} invited you to join their lobby`;
  return {
    title: message,
    description: message,
    openGraph: {
      title: message,
      description: message,
    },
  };
}

export default function InvitePage({ params }: InvitePageProps) {
  return <InviteLobbyJoin lobbyId={params.lobbyId} />;
}
