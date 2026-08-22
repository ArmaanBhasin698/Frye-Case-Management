import { describe, expect, it } from "vitest";

import { mapIntakeLeadToClientFields } from "@/lib/intake/mapToClientFields";
import { normalizeIntakeLead } from "@/lib/intake/normalize";
import { incompleteLeadEvent, newLeadEvent } from "@/lib/intake/fixtures";

describe("mapIntakeLeadToClientFields", () => {
  it("maps a normalized lead onto createClient's field shape", () => {
    const normalized = normalizeIntakeLead(newLeadEvent);
    if (!normalized.ok) throw new Error("fixture should normalize");

    expect(mapIntakeLeadToClientFields(normalized.lead)).toEqual({
      firstName: "Jordan",
      lastName: "Ellis",
      email: "jordan.ellis.fictional@example.com",
      phone: "+15550142000",
    });
  });

  it("leaves email/phone undefined when the lead didn't have them", () => {
    const mapped = mapIntakeLeadToClientFields({
      externalContactId: "x",
      firstName: "Devon",
      lastName: "Marsh",
      receivedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(mapped).toEqual({ firstName: "Devon", lastName: "Marsh", email: undefined, phone: undefined });
  });

  it("never touches the database — an incomplete lead simply fails to normalize upstream, this function is never reached", () => {
    const normalized = normalizeIntakeLead(incompleteLeadEvent);
    expect(normalized.ok).toBe(false);
  });
});
