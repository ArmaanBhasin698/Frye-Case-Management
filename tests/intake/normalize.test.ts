import { describe, expect, it } from "vitest";

import { normalizeIntakeLead } from "@/lib/intake/normalize";
import {
  duplicateNewLeadEvent,
  incompleteLeadEvent,
  malformedLeadEvent,
  newLeadEvent,
  updatedLeadEvent,
} from "@/lib/intake/fixtures";

describe("normalizeIntakeLead", () => {
  it("normalizes a new-lead event", () => {
    const result = normalizeIntakeLead(newLeadEvent);

    expect(result).toEqual({
      ok: true,
      lead: {
        externalContactId: "fictional-contact-0001",
        firstName: "Jordan",
        lastName: "Ellis",
        email: "jordan.ellis.fictional@example.com",
        phone: "+15550142000",
        receivedAt: new Date("2026-01-01T12:00:00Z"),
      },
    });
  });

  it("normalizes an updated-lead event the same way as a new one", () => {
    const result = normalizeIntakeLead(updatedLeadEvent);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lead.phone).toBe("+15550142111");
  });

  it("is a pure function: normalizing the same duplicate/retried payload twice yields identical output", () => {
    const first = normalizeIntakeLead(newLeadEvent);
    const second = normalizeIntakeLead(duplicateNewLeadEvent);
    expect(first).toEqual(second);
  });

  it("rejects an incomplete payload (missing lastName) as malformed, without throwing", () => {
    const result = normalizeIntakeLead(incompleteLeadEvent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });

  it("rejects a payload with an unrecognized type/shape as malformed", () => {
    const result = normalizeIntakeLead(malformedLeadEvent);
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid email without throwing", () => {
    const result = normalizeIntakeLead({ ...newLeadEvent, email: "not-an-email" });
    expect(result.ok).toBe(false);
  });

  it("treats an empty-string email as absent rather than invalid", () => {
    const result = normalizeIntakeLead({ ...newLeadEvent, email: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lead.email).toBeUndefined();
  });

  it("rejects a non-date dateAdded", () => {
    const result = normalizeIntakeLead({ ...newLeadEvent, dateAdded: "not-a-date" });
    expect(result).toEqual({ ok: false, reason: "malformed", detail: expect.stringContaining("dateAdded") });
  });

  it("rejects non-object input entirely", () => {
    expect(normalizeIntakeLead(null).ok).toBe(false);
    expect(normalizeIntakeLead("garbage").ok).toBe(false);
    expect(normalizeIntakeLead(42).ok).toBe(false);
  });
});
