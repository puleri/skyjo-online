"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured } from "../lib/firebase";
import { useParty } from "./LobbyProvider";

type PresenceMember = {
  id: string;
  displayName: string;
  photoURL: string | null;
  isHost: boolean;
};

const FALLBACK_LABEL = "Anonymous player";

function getMemberLabel(member: PresenceMember, isLocalUser: boolean) {
  const resolvedName = member.displayName.trim() || FALLBACK_LABEL;
  const hostSuffix = member.isHost ? " (Host)" : "";
  const localSuffix = isLocalUser ? " (You)" : "";
  return `${resolvedName}${hostSuffix}${localSuffix}`;
}

function getFallbackInitial(displayName: string) {
  const trimmedName = displayName.trim();
  if (!trimmedName || /^anonymous/i.test(trimmedName)) {
    return "?";
  }

  return trimmedName.charAt(0).toUpperCase();
}

export default function PartyPresenceCluster() {
  const { uid } = useAnonymousAuth();
  const { members, partyId } = useParty();
  const [profilePhotosById, setProfilePhotosById] = useState<Record<string, string | null>>({});

  const orderedMembers = useMemo(() => {
    if (!members.length) {
      return [];
    }

    const mappedMembers: PresenceMember[] = members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      photoURL: member.photoURL ?? null,
      isHost: member.isHost,
    }));

    const localUser = uid ? mappedMembers.find((member) => member.id === uid) ?? null : null;
    const otherMembers = mappedMembers.filter((member) => member.id !== uid);

    return localUser ? [...otherMembers, localUser] : mappedMembers;
  }, [members, uid]);

  useEffect(() => {
    if (!isFirebaseConfigured || !orderedMembers.length) {
      setProfilePhotosById({});
      return;
    }

    const unsubscribeByMember = orderedMembers.map((member) =>
      onSnapshot(doc(db, "users", member.id), (snapshot) => {
        const data = snapshot.data();
        const nextPhoto =
          typeof data?.photoUrl === "string"
            ? data.photoUrl
            : typeof data?.photoURL === "string"
              ? data.photoURL
              : null;

        setProfilePhotosById((current) => {
          if (current[member.id] === nextPhoto) {
            return current;
          }

          return {
            ...current,
            [member.id]: nextPhoto,
          };
        });
      }),
    );

    return () => {
      unsubscribeByMember.forEach((unsubscribe) => unsubscribe());
    };
  }, [orderedMembers]);

  if (!partyId || !orderedMembers.length) {
    return null;
  }

  return (
    <aside className="party-presence-cluster" aria-label="Party member presence">
      {orderedMembers.map((member, index) => {
        const isLocalUser = Boolean(uid && member.id === uid);
        const avatarLabel = getMemberLabel(member, isLocalUser);
        const resolvedPhotoUrl = profilePhotosById[member.id] ?? member.photoURL;

        return (
          <div
            key={member.id}
            className={`party-presence-cluster__member${member.isHost ? " is-host" : ""}${isLocalUser ? " is-local" : ""}`}
            title={avatarLabel}
            aria-label={avatarLabel}
            style={{ zIndex: index + 1 }}
            role="img"
          >
            {resolvedPhotoUrl ? (
              <img
                className="party-presence-cluster__photo"
                src={resolvedPhotoUrl}
                alt={avatarLabel}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="party-presence-cluster__fallback" aria-hidden="true">
                {getFallbackInitial(member.displayName)}
              </span>
            )}
          </div>
        );
      })}
    </aside>
  );
}
