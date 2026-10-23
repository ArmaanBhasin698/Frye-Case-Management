import { describe, expect, it } from "vitest";

import { buildAssociatedMatters, buildTimeline, deriveClientStatus } from "@/lib/contacts/history";
import { relationshipLabelFor } from "@/lib/contacts/labels";

function matter(id: string, status: "OPEN" | "PENDING" | "CLOSED", opened: string, lead?: string) {
  return {
    id,
    caseNumber: `CN-${id}`,
    status,
    archived: false,
    openedDate: new Date(opened),
    closedDate: status === "CLOSED" ? new Date("2026-01-01") : null,
    client: { firstName: "Jane", lastName: "Doe" },
    assignments: lead ? [{ role: "LEAD_ATTORNEY", user: { name: lead } }, { role: "PARALEGAL", user: { name: "P" } }] : [],
  };
}

describe("deriveClientStatus", () => {
  it("is current with any open or pending matter, former when all are closed", () => {
    expect(deriveClientStatus([{ status: "CLOSED" }, { status: "PENDING" }])).toBe("CURRENT");
    expect(deriveClientStatus([{ status: "CLOSED" }])).toBe("FORMER");
    expect(deriveClientStatus([])).toBe("NO_MATTERS");
  });
});

describe("buildAssociatedMatters", () => {
  it("merges client matters and role links, active first, with lead attorney and last interaction", () => {
    const rows = buildAssociatedMatters({
      clientMatters: [matter("old", "CLOSED", "2023-01-01", "Lee")],
      links: [
        { role: "WITNESS", roleDetail: null, startDate: null, endDate: null, matter: matter("new", "OPEN", "2026-01-01", "Kim") },
      ],
      lastInteractionByMatter: new Map([["old", new Date("2024-05-05")]]),
    });
    expect(rows.map((r) => [r.matter.id, r.role, r.leadAttorney])).toEqual([
      ["new", "WITNESS", "Kim"],
      ["old", "CLIENT", "Lee"],
    ]);
    expect(rows[1]!.lastInteractionAt).toEqual(new Date("2024-05-05"));
    expect(rows[0]!.lastInteractionAt).toBeNull();
  });
});

describe("buildTimeline", () => {
  it("merges manual interactions and linked calls, newest first", () => {
    const timeline = buildTimeline({
      interactions: [
        {
          id: "i1",
          type: "MEETING",
          occurredAt: new Date("2026-02-01"),
          summary: "Met",
          outcome: null,
          followUpStatus: "PENDING",
          staff: { name: "A" },
          matter: null,
        },
      ],
      calls: [
        {
          id: "c1",
          direction: "INBOUND",
          occurredAt: new Date("2026-03-01"),
          durationSeconds: 60,
          notes: null,
          filedBy: null,
          matter: { id: "m1", caseNumber: "CN" },
        },
      ],
    });
    expect(timeline.map((e) => [e.source, e.id, e.type])).toEqual([
      ["call", "c1", "CALL"],
      ["interaction", "i1", "MEETING"],
    ]);
    expect(timeline[0]!.summary).toBe("Logged call");
  });
});

describe("relationshipLabelFor", () => {
  const parentOf = { type: "PARENT" as const, fromContactId: "pat" };
  const arrested = { type: "ARRESTING_OFFICER" as const, fromContactId: "officer" };

  it("labels the other contact from the viewer's side of the relationship", () => {
    // On the child's profile, Pat is their parent; on Pat's profile, the child is their child.
    expect(relationshipLabelFor(parentOf, "child")).toBe("Parent");
    expect(relationshipLabelFor(parentOf, "pat")).toBe("Child");
  });

  it("spells out direction for asymmetric types with no natural inverse", () => {
    expect(relationshipLabelFor(arrested, "client")).toBe("Arresting officer");
    expect(relationshipLabelFor(arrested, "officer")).toBe("This contact is their arresting officer");
  });
});
