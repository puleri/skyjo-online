"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSocialPanel } from "../lib/useSocialPanel";

type SocialCirclePanelProps = {
  partyId: string | null;
  onLeaveParty?: (() => Promise<void>) | null;
  onEnsurePartyId?: (() => Promise<string>) | null;
};

type PartyLinkStatus = "idle" | "copying" | "copied" | "error";

const signInRoute = "/";

function getFriendInviteLabel(fromUserId: string) {
  return fromUserId.trim() ? `Friend request from ${fromUserId}` : "Friend request";
}

export default function SocialCirclePanel({
  partyId,
  onLeaveParty = null,
  onEnsurePartyId = null,
}: SocialCirclePanelProps) {
  const {
    invites,
    friends,
    online,
    loading,
    error,
    sendFriendInvite,
    acceptFriendInvite,
    declineFriendInvite,
    acceptPartyInvite,
    declinePartyInvite,
    inviteFriendToCurrentLobby,
  } = useSocialPanel();

  const [isInvitesOpen, setIsInvitesOpen] = useState(true);
  const [isFriendsOpen, setIsFriendsOpen] = useState(false);
  const [isOnlineOpen, setIsOnlineOpen] = useState(false);
  const [friendIdentifierInput, setFriendIdentifierInput] = useState("");
  const [isSubmittingFriendInvite, setIsSubmittingFriendInvite] = useState(false);
  const [isLeavingParty, setIsLeavingParty] = useState(false);
  const [invitingFriendUid, setInvitingFriendUid] = useState<string | null>(null);
  const [partyLinkStatus, setPartyLinkStatus] = useState<PartyLinkStatus>("idle");

  const hasInvites = invites.friend.length > 0 || invites.party.length > 0;
  const inviteRows = useMemo(
    () => [
      ...invites.friend.map((invite) => ({
        key: `friend-${invite.id}`,
        label: getFriendInviteLabel(invite.fromUserId),
        onAccept: () => acceptFriendInvite(invite.id),
        onDecline: () => declineFriendInvite(invite.id),
      })),
      ...invites.party.map((invite) => ({
        key: `party-${invite.id}`,
        label: `${invite.hostDisplayName} invited you to party ${invite.partyId}`,
        onAccept: () => acceptPartyInvite(invite.id),
        onDecline: () => declinePartyInvite(invite.id),
      })),
    ],
    [acceptFriendInvite, acceptPartyInvite, declineFriendInvite, declinePartyInvite, invites.friend, invites.party],
  );

  const onSubmitFriendInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedIdentifier = friendIdentifierInput.trim();
    if (!trimmedIdentifier) {
      return;
    }

    setIsSubmittingFriendInvite(true);
    try {
      await sendFriendInvite(trimmedIdentifier);
      setFriendIdentifierInput("");
    } finally {
      setIsSubmittingFriendInvite(false);
    }
  };

  const onClickLeaveParty = async () => {
    if (!partyId || !onLeaveParty || isLeavingParty) {
      return;
    }

    setIsLeavingParty(true);
    try {
      await onLeaveParty();
    } finally {
      setIsLeavingParty(false);
    }
  };

  const onClickSharePartyLink = async () => {
    if (partyLinkStatus === "copying") {
      return;
    }

    const resolvedPartyId = partyId ?? (onEnsurePartyId ? await onEnsurePartyId() : null);
    if (!resolvedPartyId) {
      setPartyLinkStatus("error");
      return;
    }

    setPartyLinkStatus("copying");
    try {
      const params = new URLSearchParams({ joinPartyId: resolvedPartyId });
      const partyJoinUrl = `${window.location.origin}${signInRoute}?${params.toString()}`;
      await navigator.clipboard.writeText(partyJoinUrl);
      setPartyLinkStatus("copied");
    } catch {
      setPartyLinkStatus("error");
    }
  };

  const onClickInviteFriend = async (friendUid: string) => {
    if (invitingFriendUid) {
      return;
    }

    const resolvedPartyId = partyId ?? (onEnsurePartyId ? await onEnsurePartyId() : null);
    if (!resolvedPartyId) {
      return;
    }

    setInvitingFriendUid(friendUid);
    try {
      await inviteFriendToCurrentLobby(friendUid, resolvedPartyId);
    } finally {
      setInvitingFriendUid(null);
    }
  };

  const partyLinkStatusText =
    partyLinkStatus === "copied"
      ? "Copied!"
      : partyLinkStatus === "error"
        ? "Couldn't copy party link."
        : partyLinkStatus === "copying"
          ? "Copying…"
          : null;

  return (
    <div className="social-circle-panel">
      <section className="social-circle-panel__section">
        <h3 className="social-circle-panel__heading">Add Friend</h3>
        <form className="modal__text-input-row" onSubmit={onSubmitFriendInvite}>
          <input
            type="text"
            className="modal__text-input"
            placeholder="User ID, name, or email"
            value={friendIdentifierInput}
            onChange={(event) => setFriendIdentifierInput(event.target.value)}
            aria-label="Friend identifier"
            disabled={isSubmittingFriendInvite}
          />
          <button
            type="submit"
            className="modal__inline-save-button"
            aria-label="Send friend invite"
            disabled={isSubmittingFriendInvite || !friendIdentifierInput.trim()}
          >
            +
          </button>
        </form>
      </section>

      {partyId || onEnsurePartyId ? (
        <section className="social-circle-panel__section">
          <div className="social-circle-panel__row-actions">
            {partyId ? (
              <button
                type="button"
                className="modal__inline-save-button social-circle-panel__toggle"
                onClick={() => {
                  void onClickLeaveParty();
                }}
                disabled={isLeavingParty || !onLeaveParty}
              >
                {isLeavingParty ? "Leaving party…" : "Leave Party"}
              </button>
            ) : null}
            <button
              type="button"
              className="modal__inline-save-button social-circle-panel__toggle"
              onClick={() => {
                void onClickSharePartyLink();
              }}
              disabled={partyLinkStatus === "copying" || (!partyId && !onEnsurePartyId)}
            >
              {partyLinkStatus === "copying" ? "Copying…" : "Copy Party Link"}
            </button>
          </div>
          {partyLinkStatusText ? <p className="notice">{partyLinkStatusText}</p> : null}
        </section>
      ) : null}

      <section className="social-circle-panel__section">
        <button
          type="button"
          className="profile-progression__replay-button social-circle-panel__toggle"
          onClick={() => setIsInvitesOpen((current) => !current)}
          aria-expanded={isInvitesOpen}
        >
          Invites ({inviteRows.length})
        </button>
        {isInvitesOpen ? (
          <div className="social-circle-panel__list" role="list">
            {inviteRows.length === 0 ? <p className="notice">No pending invites.</p> : null}
            {inviteRows.map((invite) => (
              <article key={invite.key} className="social-circle-panel__row" role="listitem">
                <p className="social-circle-panel__row-text">{invite.label}</p>
                <div className="social-circle-panel__row-actions">
                  <button
                    type="button"
                    className="modal__inline-save-button"
                    onClick={() => {
                      void invite.onAccept();
                    }}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="modal__inline-save-button"
                    onClick={() => {
                      void invite.onDecline();
                    }}
                  >
                    Decline
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="social-circle-panel__section">
        <button
          type="button"
          className="profile-progression__replay-button social-circle-panel__toggle"
          onClick={() => setIsFriendsOpen((current) => !current)}
          aria-expanded={isFriendsOpen}
        >
          Friends ({friends.length})
        </button>
        {isFriendsOpen ? (
          <div className="social-circle-panel__list" role="list">
            {friends.length === 0 ? <p className="notice">No friends yet.</p> : null}
            {friends.map((friend) => (
              <article key={friend.uid} className="social-circle-panel__row" role="listitem">
                <p className="social-circle-panel__row-text">{friend.displayName}</p>
                <div className="social-circle-panel__row-actions">
                  <button
                    type="button"
                    className="modal__inline-save-button"
                    onClick={() => {
                      void onClickInviteFriend(friend.uid);
                    }}
                    disabled={Boolean(invitingFriendUid)}
                  >
                    {invitingFriendUid === friend.uid ? "Inviting…" : "Invite to Lobby"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="social-circle-panel__section">
        <button
          type="button"
          className="profile-progression__replay-button social-circle-panel__toggle"
          onClick={() => setIsOnlineOpen((current) => !current)}
          aria-expanded={isOnlineOpen}
        >
          Online ({online.length})
        </button>
        {isOnlineOpen ? (
          <div className="social-circle-panel__list" role="list">
            {online.length === 0 ? <p className="notice">No friends currently in a game.</p> : null}
            {online.map((friend) => (
              <article key={friend.uid} className="social-circle-panel__row" role="listitem">
                <p className="social-circle-panel__row-text">
                  {friend.displayName}
                  {friend.activeGameId ? <span className="social-circle-panel__badge">In Game</span> : null}
                </p>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {loading && !hasInvites && friends.length === 0 ? <p className="notice">Loading social panel…</p> : null}
      {error ? <p className="notice">{error}</p> : null}
    </div>
  );
}
