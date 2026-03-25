"use client";

const pendingPartyJoinStorageKey = "misty:pending-party-join";
const pendingPartyJoinTtlMs = 30 * 60 * 1000;

type PendingPartyJoinRecord = {
  partyId: string;
  savedAtMs: number;
};

function isBrowserEnvironment() {
  return typeof window !== "undefined";
}

function parsePendingPartyJoinRecord(rawValue: string | null): PendingPartyJoinRecord | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PendingPartyJoinRecord> | string;
    if (typeof parsed === "string") {
      const partyId = parsed.trim();
      return partyId ? { partyId, savedAtMs: Date.now() } : null;
    }

    const partyId = typeof parsed.partyId === "string" ? parsed.partyId.trim() : "";
    const savedAtMs = typeof parsed.savedAtMs === "number" ? parsed.savedAtMs : 0;

    if (!partyId || !savedAtMs) {
      return null;
    }

    return { partyId, savedAtMs };
  } catch {
    return null;
  }
}

function isExpired(savedAtMs: number) {
  return Date.now() - savedAtMs > pendingPartyJoinTtlMs;
}

export function setPendingPartyJoin(partyId: string) {
  if (!isBrowserEnvironment()) {
    return;
  }

  const trimmedPartyId = partyId.trim();
  if (!trimmedPartyId) {
    clearPendingPartyJoin();
    return;
  }

  const record: PendingPartyJoinRecord = { partyId: trimmedPartyId, savedAtMs: Date.now() };
  window.localStorage.setItem(pendingPartyJoinStorageKey, JSON.stringify(record));
}

export function getPendingPartyJoin(): string | null {
  if (!isBrowserEnvironment()) {
    return null;
  }

  const parsedRecord = parsePendingPartyJoinRecord(
    window.localStorage.getItem(pendingPartyJoinStorageKey),
  );
  if (!parsedRecord || isExpired(parsedRecord.savedAtMs)) {
    clearPendingPartyJoin();
    return null;
  }

  return parsedRecord.partyId;
}

export function clearPendingPartyJoin() {
  if (!isBrowserEnvironment()) {
    return;
  }

  window.localStorage.removeItem(pendingPartyJoinStorageKey);
}
