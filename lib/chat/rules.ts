/**
 * Pure team-chat rules — no I/O, so the membership invariants are
 * unit-testable on their own (tests/chat/rules.test.ts). Prisma-backed
 * checks live in lib/chat/access.ts.
 */

/** MyCase-equivalent group DM cap: at most five participants in total, creator included. */
export const GROUP_DM_MAX_PARTICIPANTS = 5;
export const MESSAGE_MAX_LENGTH = 4_000;

/**
 * Stable key for a DIRECT or GROUP conversation's participant set (sorted,
 * de-duplicated ids). Stored as `ChatConversation.participantKey @unique`,
 * so the same people always resolve to the same conversation and a
 * different combination always needs a new one.
 */
export function participantKey(type: "DIRECT" | "GROUP", userIds: string[]): string {
  return `${type}:${[...new Set(userIds)].sort().join(",")}`;
}

/** All participants of a new DM (creator + chosen others), de-duplicated. */
export function participantsFor(creatorId: string, otherIds: string[]): string[] {
  return [...new Set([creatorId, ...otherIds])];
}

/** Returns an error message, or null when the participant set is valid for `type`. */
export function validateDirectParticipants(type: "DIRECT" | "GROUP", participants: string[]): string | null {
  if (type === "DIRECT") {
    return participants.length === 2 ? null : "A direct message is between you and exactly one other person.";
  }
  if (participants.length < 3) return "A group message needs at least two other people — use a direct message for one.";
  if (participants.length > GROUP_DM_MAX_PARTICIPANTS) {
    return `Group messages are limited to ${GROUP_DM_MAX_PARTICIPANTS} participants in total, including you.`;
  }
  return null;
}

/**
 * Only channels have dynamic membership. Direct and group messages are
 * fixed at creation — a different set of people means a new conversation.
 */
export function membershipIsFixed(type: "CHANNEL" | "DIRECT" | "GROUP"): boolean {
  return type !== "CHANNEL";
}

/**
 * The read rule, given already-resolved facts: an active membership is
 * always required (ADMIN included — admins don't silently read private
 * conversations), and a matter-linked channel additionally requires
 * current matter access, so losing matter access ends channel access even
 * though the membership row remains.
 */
export function canReadConversationFrom(facts: {
  activeMember: boolean;
  matterId: string | null;
  hasMatterAccess: boolean;
}): boolean {
  if (!facts.activeMember) return false;
  if (facts.matterId && !facts.hasMatterAccess) return false;
  return true;
}

/** Unread = messages by other people, not deleted, after the member's last read (or join). */
export function unreadSince(membership: { lastReadAt: Date | null; joinedAt: Date }): Date {
  return membership.lastReadAt ?? membership.joinedAt;
}

const URL_PATTERN = /(https:\/\/[^\s<>"']+)/g;

/**
 * Splits plain message text into text and https-link segments so the UI
 * renders React text nodes and <a> elements — never HTML. Only https URLs
 * become links; anything else (javascript:, http:, data:) stays inert text.
 */
export function segmentMessageText(body: string): { type: "text" | "link"; value: string }[] {
  const segments: { type: "text" | "link"; value: string }[] = [];
  let last = 0;
  for (const match of body.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: "text", value: body.slice(last, index) });
    segments.push({ type: "link", value: match[0] });
    last = index + match[0].length;
  }
  if (last < body.length) segments.push({ type: "text", value: body.slice(last) });
  return segments;
}
