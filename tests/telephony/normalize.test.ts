import { describe, expect, it } from "vitest";

import { normalizeVonageCallEvent } from "@/lib/telephony/normalize";
import {
  inboundCompletedWithRecordingEvent,
  inboundRingingEvent,
  malformedMissingFieldsEvent,
  outboundCompletedEvent,
  unsupportedStatusEvent,
} from "@/lib/telephony/fixtures";

describe("normalizeVonageCallEvent", () => {
  it("normalizes a completed outbound call", () => {
    const result = normalizeVonageCallEvent(outboundCompletedEvent);

    expect(result).toEqual({
      ok: true,
      event: {
        externalCallId: "fictional-conv-outbound-0002",
        direction: "OUTBOUND",
        fromNumber: outboundCompletedEvent.from,
        toNumber: outboundCompletedEvent.to,
        occurredAt: new Date(1735689600 * 1000),
        durationSeconds: 180,
        recordingRef: undefined,
      },
    });
  });

  it("normalizes a completed inbound call carrying a recording reference", () => {
    const result = normalizeVonageCallEvent(inboundCompletedWithRecordingEvent);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.direction).toBe("INBOUND");
      expect(result.event.recordingRef).toBe(inboundCompletedWithRecordingEvent.recording_url);
      expect(result.event.durationSeconds).toBe(240);
    }
  });

  it("ignores a non-terminal recognized status (still in progress) rather than erroring", () => {
    const result = normalizeVonageCallEvent(inboundRingingEvent);
    expect(result).toEqual({ ok: false, reason: "unsupported_status", detail: expect.stringContaining("ringing") });
  });

  it("ignores a recognized terminal-but-not-completed status (e.g. busy)", () => {
    const result = normalizeVonageCallEvent(unsupportedStatusEvent);
    expect(result).toEqual({ ok: false, reason: "unsupported_status", detail: expect.stringContaining("busy") });
  });

  it("rejects a payload missing required fields as malformed, without throwing", () => {
    const result = normalizeVonageCallEvent(malformedMissingFieldsEvent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });

  it("rejects a completed call with no duration as malformed", () => {
    const result = normalizeVonageCallEvent({ ...outboundCompletedEvent, duration: undefined });
    expect(result).toEqual({ ok: false, reason: "malformed", detail: expect.stringContaining("duration") });
  });

  it("rejects a non-numeric start_time as malformed", () => {
    const result = normalizeVonageCallEvent({ ...outboundCompletedEvent, start_time: "not-a-timestamp" });
    expect(result).toEqual({ ok: false, reason: "malformed", detail: expect.stringContaining("start_time") });
  });

  it("rejects a completely unrecognized status", () => {
    const result = normalizeVonageCallEvent({ ...outboundCompletedEvent, status: "teleported" });
    expect(result).toEqual({ ok: false, reason: "malformed", detail: expect.stringContaining("teleported") });
  });

  it("rejects non-object input entirely", () => {
    expect(normalizeVonageCallEvent(null).ok).toBe(false);
    expect(normalizeVonageCallEvent("garbage").ok).toBe(false);
    expect(normalizeVonageCallEvent(undefined).ok).toBe(false);
  });
});
