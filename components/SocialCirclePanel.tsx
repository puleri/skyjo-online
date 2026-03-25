"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSocialPanel } from "../lib/useSocialPanel";

type SocialCirclePanelProps = {
  partyId: string | null;
};

function getFriendInviteLabel(fromUserId: string) {
  return fromUserId.trim() ? `Friend request from ${fromUserId}` : "Friend request";
}

export default function SocialCirclePanel({ partyId }: SocialCirclePanelProps) {
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
                      if (!partyId) {
                        return;
                      }
                      void inviteFriendToCurrentLobby(friend.uid, partyId);
                    }}
                    disabled={!partyId}
                  >
                    Invite to Lobby
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
