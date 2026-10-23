import { describe, expect, it, vi } from "vitest";

import {
  buildPreview,
  isEventMovable,
  isTaskMovable,
  resolveAssignee,
  scheduleStep,
  type MatterTeam,
  type StepInput,
} from "@/lib/workflows/schedule";
import { installStarterTemplates, STARTER_TEMPLATES } from "@/lib/workflows/starters";
import { readTemplateFields } from "@/lib/workflows/fields";

const NY = "America/New_York";

describe("scheduleStep — calendar-day offsets", () => {
  it("puts task due dates on the anchor's wall date plus calendar days, including negative offsets", () => {
    const t = scheduleStep({ kind: "TASK", offsetDays: -1, timeOfDay: null, durationMinutes: null }, "2026-03-01", NY);
    expect(t).toEqual({ kind: "TASK", dateKey: "2026-02-28", dueDate: new Date("2026-02-28T00:00:00Z") });
    const later = scheduleStep({ kind: "TASK", offsetDays: 30, timeOfDay: null, durationMinutes: null }, "2026-01-15", NY);
    expect(later.dateKey).toBe("2026-02-14");
  });

  it("keeps a timed event at the same wall-clock time across the spring-forward boundary", () => {
    const before = scheduleStep({ kind: "EVENT", offsetDays: 0, timeOfDay: "10:00", durationMinutes: 30 }, "2026-03-07", NY);
    const after = scheduleStep({ kind: "EVENT", offsetDays: 1, timeOfDay: "10:00", durationMinutes: 30 }, "2026-03-07", NY);
    expect(before.kind === "EVENT" && before.startTime.toISOString()).toBe("2026-03-07T15:00:00.000Z"); // EST
    expect(after.kind === "EVENT" && after.startTime.toISOString()).toBe("2026-03-08T14:00:00.000Z"); // EDT
    expect(after.kind === "EVENT" && after.endTime.getTime() - after.startTime.getTime()).toBe(30 * 60_000);
  });

  it("handles the fall-back boundary and defaults event duration to 60 minutes", () => {
    const fall = scheduleStep({ kind: "EVENT", offsetDays: 1, timeOfDay: "10:00", durationMinutes: null }, "2026-10-31", NY);
    expect(fall.kind === "EVENT" && fall.startTime.toISOString()).toBe("2026-11-01T15:00:00.000Z");
    expect(fall.kind === "EVENT" && fall.endTime.toISOString()).toBe("2026-11-01T16:00:00.000Z");
  });

  it("makes an event with no time of day all-day, spanning the local day (23h on spring-forward day)", () => {
    const s = scheduleStep({ kind: "EVENT", offsetDays: 0, timeOfDay: null, durationMinutes: null }, "2026-03-08", NY);
    expect(s.kind === "EVENT" && s.allDay).toBe(true);
    expect(s.kind === "EVENT" && s.startTime.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(s.kind === "EVENT" && s.endTime.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("rejects an invalid anchor", () => {
    expect(() => scheduleStep({ kind: "TASK", offsetDays: 0, timeOfDay: null, durationMinutes: null }, "2026-02-30", NY)).toThrow();
  });
});

const team: MatterTeam = {
  assignments: [
    { userId: "lead", name: "Lead Attorney", role: "LEAD_ATTORNEY", status: "ACTIVE", assignedAt: new Date("2026-01-01") },
    { userId: "para-late", name: "Late Paralegal", role: "PARALEGAL", status: "ACTIVE", assignedAt: new Date("2026-03-01") },
    { userId: "para-early", name: "Early Paralegal", role: "PARALEGAL", status: "ACTIVE", assignedAt: new Date("2026-02-01") },
    { userId: "gone", name: "Inactive", role: "STAFF", status: "INACTIVE", assignedAt: new Date("2026-01-01") },
  ],
  admins: [{ userId: "admin", name: "Admin", status: "ACTIVE" }],
};

describe("resolveAssignee — only users with matter access", () => {
  it("resolves the lead attorney and the earliest paralegal", () => {
    expect(resolveAssignee({ assigneeRule: "LEAD_ATTORNEY", assigneeUserId: null }, team).userId).toBe("lead");
    expect(resolveAssignee({ assigneeRule: "ASSIGNED_PARALEGAL", assigneeUserId: null }, team).userId).toBe("para-early");
  });

  it("leaves the item unassigned with a note when the rule can't be satisfied", () => {
    const noLead = resolveAssignee({ assigneeRule: "LEAD_ATTORNEY", assigneeUserId: null }, { assignments: [], admins: [] });
    expect(noLead).toMatchObject({ userId: null, note: expect.stringContaining("lead attorney") });
  });

  it("never assigns a specific user who isn't on the matter or is inactive; admins qualify", () => {
    expect(resolveAssignee({ assigneeRule: "SPECIFIC_USER", assigneeUserId: "outsider" }, team).userId).toBeNull();
    expect(resolveAssignee({ assigneeRule: "SPECIFIC_USER", assigneeUserId: "gone" }, team).userId).toBeNull();
    expect(resolveAssignee({ assigneeRule: "SPECIFIC_USER", assigneeUserId: "admin" }, team).userId).toBe("admin");
  });
});

describe("buildPreview / movability", () => {
  it("orders by position and resolves each item", () => {
    const steps: StepInput[] = [
      { id: "b", position: 1, kind: "EVENT", title: "B", description: null, priority: "NORMAL", offsetDays: 2, timeOfDay: "09:00", durationMinutes: 30, eventType: "MEETING", assigneeRule: "LEAD_ATTORNEY", assigneeUserId: null },
      { id: "a", position: 0, kind: "TASK", title: "A", description: null, priority: "HIGH", offsetDays: 0, timeOfDay: null, durationMinutes: null, eventType: null, assigneeRule: "UNASSIGNED", assigneeUserId: null },
    ];
    const items = buildPreview(steps, "2026-05-01", NY, team);
    expect(items.map((i) => [i.stepId, i.schedule.dateKey, i.assignee.userId])).toEqual([
      ["a", "2026-05-01", null],
      ["b", "2026-05-03", "lead"],
    ]);
  });

  it("only moves open tasks and future scheduled events", () => {
    expect(isTaskMovable("OPEN")).toBe(true);
    expect(isTaskMovable("DONE")).toBe(false);
    expect(isTaskMovable("CANCELLED")).toBe(false);
    const now = new Date("2026-06-01T12:00:00Z");
    expect(isEventMovable({ status: "SCHEDULED", startTime: new Date("2026-06-02T00:00:00Z") }, now)).toBe(true);
    expect(isEventMovable({ status: "SCHEDULED", startTime: new Date("2026-05-31T00:00:00Z") }, now)).toBe(false);
    expect(isEventMovable({ status: "CANCELLED", startTime: new Date("2026-06-02T00:00:00Z") }, now)).toBe(false);
  });
});

describe("template validation", () => {
  const fd = (steps: unknown) => {
    const f = new FormData();
    f.set("name", "Fictional template");
    f.set("category", "OTHER");
    f.set("steps", JSON.stringify(steps));
    return f;
  };

  it("requires at least one titled step and whole-day offsets", () => {
    expect(readTemplateFields(fd([])).success).toBe(false);
    expect(readTemplateFields(fd([{ kind: "TASK", title: "", offsetDays: 0 }])).success).toBe(false);
    expect(readTemplateFields(fd([{ kind: "TASK", title: "x", offsetDays: 1.5 }])).success).toBe(false);
  });

  it("drops event-only fields from tasks and requires a user for SPECIFIC_USER", () => {
    const ok = readTemplateFields(fd([{ kind: "TASK", title: "x", offsetDays: 1, timeOfDay: "09:00", assigneeRule: "UNASSIGNED", assigneeUserId: "u1" }]));
    expect(ok.success && ok.data.steps[0]).toMatchObject({ timeOfDay: null, eventType: null, assigneeUserId: null });
    expect(readTemplateFields(fd([{ kind: "TASK", title: "x", offsetDays: 1, assigneeRule: "SPECIFIC_USER" }])).success).toBe(false);
  });

  it("rejects malformed steps JSON", () => {
    const f = new FormData();
    f.set("name", "x");
    f.set("category", "OTHER");
    f.set("steps", "{not json");
    expect(readTemplateFields(f).success).toBe(false);
  });
});

describe("starter templates", () => {
  it("installs missing starters only (idempotent by name) as editable DB rows", async () => {
    const db = {
      workflowTemplate: {
        findMany: vi.fn().mockResolvedValue([{ name: "Discovery review" }]),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const created = await installStarterTemplates(db as never, "admin");
    expect(created).not.toContain("Discovery review");
    expect(created).toHaveLength(STARTER_TEMPLATES.length - 1);
    expect(db.workflowTemplate.create.mock.calls[0]![0].data.versions.create.version).toBe(1);
    expect(readTemplateFields((() => {
      const f = new FormData();
      const s = STARTER_TEMPLATES[0]!;
      f.set("name", s.name);
      f.set("category", s.category);
      f.set("steps", JSON.stringify(s.steps));
      return f;
    })()).success).toBe(true);
  });
});
