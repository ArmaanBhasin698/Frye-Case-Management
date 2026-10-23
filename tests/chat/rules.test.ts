import { describe, expect, it } from "vitest";

import {
  GROUP_DM_MAX_PARTICIPANTS,
  canReadConversationFrom,
  membershipIsFixed,
  participantKey,
  participantsFor,
  segmentMessageText,
  unreadSince,
  validateDirectParticipants,
} from "@/lib/chat/rules";

describe("participant sets", () => {
  it("keys the same people identically regardless of order or duplicates", () => {
    expect(participantKey("GROUP", ["c", "a", "b", "a"])).toBe(participantKey("GROUP", ["b", "c", "a"]));
    expect(participantKey("DIRECT", ["a", "b"])).not.toBe(participantKey("GROUP", ["a", "b"]));
  });

  it("always includes the creator once", () => {
    expect(participantsFor("me", ["x", "me", "x"])).toEqual(["me", "x"]);
  });

  it("requires exactly two people for a DM", () => {
    expect(validateDirectParticipants("DIRECT", ["me", "x"])).toBeNull();
    expect(validateDirectParticipants("DIRECT", ["me"])).not.toBeNull();
  });

  it("caps group DMs at five participants total, creator included", () => {
    expect(GROUP_DM_MAX_PARTICIPANTS).toBe(5);
    expect(validateDirectParticipants("GROUP", ["me", "a", "b", "c", "d"])).toBeNull();
    expect(validateDirectParticipants("GROUP", ["me", "a", "b", "c", "d", "e"])).toMatch(/limited to 5/);
    expect(validateDirectParticipants("GROUP", ["me", "a"])).not.toBeNull();
  });

  it("fixes membership for DMs and group DMs, not channels", () => {
    expect(membershipIsFixed("DIRECT")).toBe(true);
    expect(membershipIsFixed("GROUP")).toBe(true);
    expect(membershipIsFixed("CHANNEL")).toBe(false);
  });
});

describe("canReadConversationFrom", () => {
  it("requires active membership, even with matter access", () => {
    expect(canReadConversationFrom({ activeMember: false, matterId: null, hasMatterAccess: true })).toBe(false);
  });

  it("revokes a matter channel when matter access is gone, despite membership", () => {
    expect(canReadConversationFrom({ activeMember: true, matterId: "m1", hasMatterAccess: false })).toBe(false);
    expect(canReadConversationFrom({ activeMember: true, matterId: "m1", hasMatterAccess: true })).toBe(true);
  });
});

describe("unreadSince", () => {
  it("counts from last read, or from joining when never read", () => {
    const joined = new Date("2026-01-01");
    const read = new Date("2026-02-01");
    expect(unreadSince({ joinedAt: joined, lastReadAt: null })).toBe(joined);
    expect(unreadSince({ joinedAt: joined, lastReadAt: read })).toBe(read);
  });
});

describe("segmentMessageText", () => {
  it("links only https URLs and leaves everything else as inert text", () => {
    expect(segmentMessageText("see https://example.com/a?b=1 now")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://example.com/a?b=1" },
      { type: "text", value: " now" },
    ]);
    const unsafe = segmentMessageText("javascript:alert(1) http://x.test <script>alert(1)</script>");
    expect(unsafe.every((s) => s.type === "text")).toBe(true);
  });
});
