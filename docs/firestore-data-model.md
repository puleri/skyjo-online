# Firestore data model notes

## Collections and fields

### `friendInvites/{inviteId}`

Required fields:

- `fromUserId: string`
- `toUserId: string`
- `status: "pending" | "accepted" | "declined"`
- `createdAt: Timestamp`
- `updatedAt: Timestamp`
- `respondedAt: Timestamp` (set when accepted or declined)

Behavior on accept:

- Use one transaction to:
  - add each user ID to the opposite `users/{uid}.friends` array
  - set `friendInvites/{inviteId}.status = "accepted"`
  - set `respondedAt` and `updatedAt`

### `partyInvites/{inviteId}`

Existing collection; keep these fields for pending inbox queries:

- `inviteeId: string`
- `status: string` (at minimum `pending`, `accepted`, `declined`)

For parity with other invite collections and future inbox normalization, also include:

- `fromUserId: string`
- `toUserId: string`

### `users/{uid}`

Keep:

- `friends: string[]`

Presence/game-status additions:

- `activeGameId: string | null`
- `presenceState: "online" | "in_game" | "offline"`
- `lastSeenAt: Timestamp | null`

## Expected composite indexes

- `friendInvites`: `toUserId ASC`, `status ASC`
- `partyInvites`: `inviteeId ASC`, `status ASC`
