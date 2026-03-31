"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useAnonymousAuth } from "../lib/auth";
import { db, isFirebaseConfigured } from "../lib/firebase";
import { subscribeToUsersByIdChunks } from "../lib/userSubscriptions";
import { useUserProfile } from "../lib/useUserProfile";
import { useParty } from "./LobbyProvider";
import SocialCirclePanel from "./SocialCirclePanel";

type PresenceMember = {
  id: string;
  displayName: string;
  photoURL: string | null;
  isHost: boolean;
};

type PartyInviteCopyStatus = "idle" | "copying" | "copied" | "error";

const FALLBACK_LABEL = "Anonymous player";
const MAX_PARTY_MEMBERS = 8;
const signInRoute = "/";

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
  const { uid, displayName, profileDisplayName } = useAnonymousAuth();
  const { members, partyId, ensurePartyId, leave } = useParty();
  const [profilePhotosById, setProfilePhotosById] = useState<Record<string, string | null>>({});
  const [isSageOpen, setIsSageOpen] = useState(false);
  const [sageAnimationPhase, setSageAnimationPhase] = useState<"opening" | "open" | "closing">("closing");
  const [didCopyUserId, setDidCopyUserId] = useState(false);
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [isSavingDisplayName, setIsSavingDisplayName] = useState(false);
  const [partyInviteCopyStatus, setPartyInviteCopyStatus] = useState<PartyInviteCopyStatus>("idle");
  const localTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partyInviteCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { updateProfile } = useUserProfile();

  const orderedMembers = useMemo(() => {
    const mappedMembers: PresenceMember[] = members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      photoURL: member.photoURL ?? null,
      isHost: member.isHost,
    }));

    if (!mappedMembers.length && uid) {
      const fallbackLocalDisplayName =
        profileDisplayName?.trim() || displayName?.trim() || FALLBACK_LABEL;
      mappedMembers.push({
        id: uid,
        displayName: fallbackLocalDisplayName,
        photoURL: null,
        isHost: false,
      });
    }

    const localUser = uid ? mappedMembers.find((member) => member.id === uid) ?? null : null;
    const otherMembers = mappedMembers.filter((member) => member.id !== uid);

    return localUser ? [...otherMembers, localUser] : mappedMembers;
  }, [displayName, members, profileDisplayName, uid]);

  const localMember = useMemo(
    () => (uid ? orderedMembers.find((member) => member.id === uid) ?? null : null),
    [orderedMembers, uid],
  );

  useEffect(() => {
    if (!isFirebaseConfigured || !orderedMembers.length) {
      setProfilePhotosById({});
      return;
    }

    const memberIds = orderedMembers.map((member) => member.id);

    setProfilePhotosById((current) => {
      const trimmedEntries = Object.entries(current).filter(([memberId]) => memberIds.includes(memberId));
      if (trimmedEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(trimmedEntries);
    });

    return subscribeToUsersByIdChunks({
      db,
      userIds: memberIds,
      onChunkSnapshot: (docs) => {
        const chunkPhotos: Record<string, string | null> = {};

        docs.forEach((snapshotDoc) => {
          const data = snapshotDoc.data();
          chunkPhotos[snapshotDoc.id] =
            typeof data?.photoUrl === "string"
              ? data.photoUrl
              : typeof data?.photoURL === "string"
                ? data.photoURL
                : null;
        });

        setProfilePhotosById((current) => {
          let hasChanges = false;
          const next = { ...current };

          Object.entries(chunkPhotos).forEach(([memberId, nextPhoto]) => {
            if (next[memberId] !== nextPhoto) {
              next[memberId] = nextPhoto;
              hasChanges = true;
            }
          });

          return hasChanges ? next : current;
        });
      },
      onError: () => {
        // Fallback photos from orderedMembers remain in use when profile snapshots fail.
      },
    });
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
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      if (partyInviteCopyTimerRef.current) {
        clearTimeout(partyInviteCopyTimerRef.current);
      }
    };
  }, []);

  const onClickCopyPartyInviteLink = async () => {
    if (partyInviteCopyStatus === "copying") {
      return;
    }

    const resolvedPartyId = partyId ?? (ensurePartyId ? await ensurePartyId() : null);
    if (!resolvedPartyId) {
      setPartyInviteCopyStatus("error");
      return;
    }

    setPartyInviteCopyStatus("copying");
    try {
      const params = new URLSearchParams({ joinPartyId: resolvedPartyId });
      const partyJoinUrl = `${window.location.origin}${signInRoute}?${params.toString()}`;
      await navigator.clipboard.writeText(partyJoinUrl);
      setPartyInviteCopyStatus("copied");
      if (partyInviteCopyTimerRef.current) {
        clearTimeout(partyInviteCopyTimerRef.current);
      }
      partyInviteCopyTimerRef.current = setTimeout(() => {
        setPartyInviteCopyStatus("idle");
      }, 1800);
    } catch {
      setPartyInviteCopyStatus("error");
    }
  };

  const localUserDisplayName = localMember?.displayName.trim() || FALLBACK_LABEL;
  const localUserPhotoUrl = localMember ? (profilePhotosById[localMember.id] ?? localMember.photoURL) : null;

  useEffect(() => {
    if (isEditingDisplayName) {
      return;
    }

    setDisplayNameDraft(localUserDisplayName);
  }, [isEditingDisplayName, localUserDisplayName]);

  const copyUserId = async () => {
    if (!localMember?.id) {
      return;
    }

    try {
      await navigator.clipboard.writeText(localMember.id);
      setDidCopyUserId(true);
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        setDidCopyUserId(false);
      }, 1800);
    } catch {
      setDidCopyUserId(false);
    }
  };

  const openSagePanel = (trigger?: HTMLButtonElement | null) => {
    if (trigger) {
      localTriggerRef.current = trigger;
    }

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

    setIsEditingDisplayName(false);
    setIsSavingDisplayName(false);
    setDisplayNameDraft(localUserDisplayName);
    setSageAnimationPhase("closing");
  };

  const beginDisplayNameEdit = () => {
    setDisplayNameDraft(localUserDisplayName);
    setIsEditingDisplayName(true);
  };

  const cancelDisplayNameEdit = () => {
    setDisplayNameDraft(localUserDisplayName);
    setIsEditingDisplayName(false);
  };

  const saveDisplayNameEdit = async () => {
    const nextDisplayName = displayNameDraft.trim();
    if (!nextDisplayName || nextDisplayName === localUserDisplayName || isSavingDisplayName) {
      setDisplayNameDraft(localUserDisplayName);
      setIsEditingDisplayName(false);
      return;
    }

    try {
      setIsSavingDisplayName(true);
      await updateProfile({ displayName: nextDisplayName });
      setIsEditingDisplayName(false);
    } catch {
      setDisplayNameDraft(localUserDisplayName);
      setIsEditingDisplayName(false);
    } finally {
      setIsSavingDisplayName(false);
    }
  };

  if (!orderedMembers.length) {
    return null;
  }
  const shouldShowInviteShortcut = orderedMembers.length < MAX_PARTY_MEMBERS;

  return (
    <>
      <aside className="party-presence-cluster" aria-label="Party member presence">
        {shouldShowInviteShortcut ? (
          <button
            type="button"
            className="party-presence-cluster__member party-presence-cluster__invite-shortcut"
            aria-label="Copy party invite link"
            title="Copy party invite link"
            onClick={() => {
              void onClickCopyPartyInviteLink();
            }}
          >
            <span aria-hidden="true">+</span>
            {partyInviteCopyStatus === "copied" ? (
              <span className="party-presence-cluster__invite-tooltip" role="status" aria-live="polite">
                Party invite copied
              </span>
            ) : null}
          </button>
        ) : null}
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
              <Fragment key={member.id}>
                <button
                  ref={localTriggerRef}
                  type="button"
                  className={`party-presence-cluster__member party-presence-cluster__member-trigger party-presence-cluster__member-trigger--desktop${member.isHost ? " is-host" : ""} is-local`}
                  title={avatarLabel}
                  aria-label={avatarLabel}
                  aria-haspopup="dialog"
                  aria-expanded={isSageOpen}
                  style={{ zIndex: index + (shouldShowInviteShortcut ? 2 : 1) }}
                  onClick={(event) => openSagePanel(event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openSagePanel(event.currentTarget);
                    }
                  }}
                >
                  {avatarContent}
                </button>
                <div
                  className={`party-presence-cluster__member party-presence-cluster__member-indicator--mobile${member.isHost ? " is-host" : ""} is-local`}
                  title={avatarLabel}
                  aria-label={avatarLabel}
                  style={{ zIndex: index + (shouldShowInviteShortcut ? 2 : 1) }}
                  role="img"
                >
                  {avatarContent}
                </div>
              </Fragment>
            );
          }

          return (
            <div
              key={member.id}
              className={`party-presence-cluster__member${member.isHost ? " is-host" : ""}`}
              title={avatarLabel}
              aria-label={avatarLabel}
              style={{ zIndex: index + (shouldShowInviteShortcut ? 2 : 1) }}
              role="img"
            >
              {avatarContent}
            </div>
          );
        })}
      </aside>

      {localMember ? (
        <button
          type="button"
          className="party-presence-cluster__open-button"
          aria-label="Open social panel"
          aria-haspopup="dialog"
          aria-expanded={isSageOpen}
          onClick={(event) => openSagePanel(event.currentTarget)}
        >
          <span className="party-presence-cluster__open-button-avatar" aria-hidden="true">
            {(profilePhotosById[localMember.id] ?? localMember.photoURL) ? (
              <img
                className="party-presence-cluster__photo"
                src={profilePhotosById[localMember.id] ?? localMember.photoURL ?? ""}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="party-presence-cluster__fallback">{getFallbackInitial(localMember.displayName)}</span>
            )}
          </span>
          <span className="party-presence-cluster__open-button-label">Social</span>
          <span className="party-presence-cluster__open-button-icon" aria-hidden="true">
            ▾
          </span>
        </button>
      ) : null}

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
              <div className="party-presence-cluster__sage-header">
                <div className="party-presence-cluster__sage-title-group">
                  <div className="party-presence-cluster__sage-profile-heading">
                    <span className="party-presence-cluster__sage-profile-photo" aria-hidden="true">
                      {localUserPhotoUrl ? (
                        <img
                          className="party-presence-cluster__photo"
                          src={localUserPhotoUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="party-presence-cluster__fallback">
                          {getFallbackInitial(localUserDisplayName)}
                        </span>
                      )}
                    </span>
                    {isEditingDisplayName ? (
                      <>
                        <input
                          id="party-presence-sage-title"
                          className="party-presence-cluster__sage-title-input"
                          value={displayNameDraft}
                          onChange={(event) => setDisplayNameDraft(event.target.value)}
                          aria-label="Display name"
                          disabled={isSavingDisplayName}
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveDisplayNameEdit();
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelDisplayNameEdit();
                            }
                          }}
                        />
                        <div className="party-presence-cluster__sage-profile-actions">
                          <button
                            type="button"
                            className="party-presence-cluster__sage-icon-button"
                            aria-label="Cancel display name edit"
                            onClick={cancelDisplayNameEdit}
                            disabled={isSavingDisplayName}
                          >
                            ×
                          </button>
                          <button
                            type="button"
                            className="party-presence-cluster__sage-icon-button party-presence-cluster__sage-icon-button--confirm"
                            aria-label="Save display name"
                            onClick={() => {
                              void saveDisplayNameEdit();
                            }}
                            disabled={isSavingDisplayName}
                          >
                            ✓
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <h2 id="party-presence-sage-title" className="party-presence-cluster__sage-title">
                          {localUserDisplayName}
                        </h2>
                        <button
                          type="button"
                          className="party-presence-cluster__sage-icon-button party-presence-cluster__sage-edit-button"
                          aria-label="Edit display name"
                          onClick={beginDisplayNameEdit}
                        >
                          ✎
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="party-presence-cluster__sage-close"
                  aria-label="Close social panel"
                  onClick={closeSagePanel}
                >
                  ×
                </button>
              </div>
              <div className="party-presence-cluster__sage-body">
                <SocialCirclePanel
                  partyId={partyId}
                  onLeaveParty={partyId ? leave : null}
                  onEnsurePartyId={ensurePartyId}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
