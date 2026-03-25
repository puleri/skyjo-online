"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured } from "../lib/firebase";
import { useParty } from "./LobbyProvider";
import SocialCirclePanel from "./SocialCirclePanel";

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
  const [isSageOpen, setIsSageOpen] = useState(false);
  const [sageAnimationPhase, setSageAnimationPhase] = useState<"opening" | "open" | "closing">("closing");
  const localTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!isSageOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSageAnimationPhase("closing");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isSageOpen]);

  useEffect(() => {
    if (!isSageOpen || sageAnimationPhase !== "closing") {
      return;
    }

    closeTimerRef.current = setTimeout(() => {
      setIsSageOpen(false);
      localTriggerRef.current?.focus();
    }, 220);

    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [isSageOpen, sageAnimationPhase]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const openSagePanel = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setIsSageOpen(true);
    setSageAnimationPhase("opening");

    requestAnimationFrame(() => {
      setSageAnimationPhase("open");
    });
  };

  const closeSagePanel = () => {
    if (!isSageOpen) {
      return;
    }

    setSageAnimationPhase("closing");
  };

  if (!partyId || !orderedMembers.length) {
    return null;
  }

  return (
    <>
      <aside className="party-presence-cluster" aria-label="Party member presence">
        {orderedMembers.map((member, index) => {
          const isLocalUser = Boolean(uid && member.id === uid);
          const avatarLabel = getMemberLabel(member, isLocalUser);
          const resolvedPhotoUrl = profilePhotosById[member.id] ?? member.photoURL;

          const avatarContent = resolvedPhotoUrl ? (
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
          );

          if (isLocalUser) {
            return (
              <button
                key={member.id}
                ref={localTriggerRef}
                type="button"
                className={`party-presence-cluster__member party-presence-cluster__member-trigger${member.isHost ? " is-host" : ""} is-local`}
                title={avatarLabel}
                aria-label={avatarLabel}
                aria-haspopup="dialog"
                aria-expanded={isSageOpen}
                style={{ zIndex: index + 1 }}
                onClick={openSagePanel}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openSagePanel();
                  }
                }}
              >
                {avatarContent}
              </button>
            );
          }

          return (
            <div
              key={member.id}
              className={`party-presence-cluster__member${member.isHost ? " is-host" : ""}`}
              title={avatarLabel}
              aria-label={avatarLabel}
              style={{ zIndex: index + 1 }}
              role="img"
            >
              {avatarContent}
            </div>
          );
        })}
      </aside>

      {isSageOpen ? (
        <div
          className={`party-presence-cluster__sage-modal party-presence-cluster__sage-modal--${sageAnimationPhase}`}
          onClick={closeSagePanel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="party-presence-sage-title"
        >
          <div className="party-presence-cluster__sage-panel" onClick={(event) => event.stopPropagation()}>
            <div className="party-presence-cluster__sage-content">
              <h2 id="party-presence-sage-title" className="party-presence-cluster__sage-title">
                Party Sage
              </h2>
              <SocialCirclePanel partyId={partyId} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
