import { describe, expect, it } from "vitest";

import {
  eventReminderOffsets,
  planNotifications,
  upcomingOccurrences,
  type PlannerEvent,
  type PlannerSnapshot,
  type PlannerTask,
  type PlannerUser,
} from "@/lib/notifications/planner";

const NOW = new Date("2026-11-10T15:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function user(id: string, matters: string[] = [], isAdmin = false): PlannerUser {
  return { id, isAdmin, assignedMatterIds: new Set(matters) };
}

function snapshot(partial: Partial<PlannerSnapshot>): PlannerSnapshot {
  return {
    users: new Map([
      ["att", user("att", ["m1"])],
      ["para", user("para", ["m1"])],
      ["outsider", user("outsider", ["m2"])],
      ["admin", user("admin", [], true)],
    ]),
    tasks: [],
    deadlines: [],
    events: [],
    conversations: [],
    disabled: new Set(),
    ...partial,
  };
}

function task(overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id: "t1",
    matterId: "m1",
    assignedToId: "att",
    dueDate: new Date("2026-11-11T00:00:00Z"),
    status: "OPEN",
    reminderOffsetsMinutes: [],
    updatedAt: new Date(NOW.getTime() - 30 * DAY),
    ...overrides,
  };
}

function event(overrides: Partial<PlannerEvent> = {}): PlannerEvent {
  return {
    id: "e1",
    matterId: "m1",
    type: "HEARING",
    status: "SCHEDULED",
    createdById: "att",
    attendeeIds: ["para"],
    startTime: new Date(NOW.getTime() + 30 * 60_000),
    endTime: null,
    timeZone: "America/New_York",
    recurrenceFrequency: "NONE",
    recurrenceInterval: 1,
    recurrenceUntil: null,
    recurrenceCount: null,
    reminderMinutesBefore: 60,
    reminderOffsetsMinutes: [],
    createdAt: new Date(NOW.getTime() - 30 * DAY),
    updatedAt: new Date(NOW.getTime() - 30 * DAY),
    lastEditorId: null,
    exceptions: [],
    ...overrides,
  };
}

const kinds = (s: PlannerSnapshot, now = NOW) => planNotifications(now, s).map((n) => `${n.userId}:${n.kind}`).sort();

describe("tasks", () => {
  it("reminds the assignee one day before by default, and only them", () => {
    expect(kinds(snapshot({ tasks: [task()] }))).toEqual(["att:TASK_DUE"]);
  });

  it("does not remind before the reminder window opens", () => {
    expect(kinds(snapshot({ tasks: [task({ dueDate: new Date("2026-11-13T00:00:00Z") })] }))).toEqual([]);
  });

  it("uses each explicit offset with its own dedupe key", () => {
    const planned = planNotifications(NOW, snapshot({ tasks: [task({ reminderOffsetsMinutes: [60, 2 * 24 * 60] })] }));
    expect(planned.map((n) => n.dedupeKey)).toEqual(["task:t1:due:2026-11-11T00:00:00.000Z:2880"]);
  });

  it("re-arms when the due date is rescheduled (new dedupe key)", () => {
    const a = planNotifications(NOW, snapshot({ tasks: [task()] }))[0]!.dedupeKey;
    const b = planNotifications(NOW, snapshot({ tasks: [task({ dueDate: new Date("2026-11-10T12:00:00Z") })] }))[0]!.dedupeKey;
    expect(a).not.toBe(b);
  });

  it("flags overdue once the due day has fully passed", () => {
    expect(kinds(snapshot({ tasks: [task({ dueDate: new Date("2026-11-08T00:00:00Z") })] }))).toEqual(["att:TASK_OVERDUE"]);
  });

  it("never notifies for completed or cancelled tasks", () => {
    for (const status of ["DONE", "CANCELLED"] as const) {
      expect(kinds(snapshot({ tasks: [task({ status, updatedAt: NOW })] }))).toEqual([]);
    }
  });

  it("notifies a recent assignment, keyed to the assignee", () => {
    const planned = planNotifications(NOW, snapshot({ tasks: [task({ dueDate: null, updatedAt: new Date(NOW.getTime() - HOUR) })] }));
    expect(planned).toEqual([expect.objectContaining({ userId: "att", kind: "TASK_ASSIGNED", dedupeKey: "task:t1:assignee:att" })]);
  });

  it("skips an assignee who no longer has access to the matter", () => {
    expect(kinds(snapshot({ tasks: [task({ assignedToId: "outsider" })] }))).toEqual([]);
  });

  it("never puts task text in the title", () => {
    for (const n of planNotifications(NOW, snapshot({ tasks: [task({ updatedAt: NOW })] }))) {
      expect(n.title).not.toMatch(/t1/);
      expect(["Task due soon", "Task assigned to you"]).toContain(n.title);
    }
  });
});

describe("deadlines", () => {
  const deadline = { id: "d1", matterId: "m1", date: new Date("2026-11-15T00:00:00Z"), reminderDaysBefore: 7, satisfied: false, recipientIds: ["att", "para", "outsider"] };

  it("reminds the matter's assigned staff inside the reminder window, not outsiders", () => {
    expect(kinds(snapshot({ deadlines: [deadline] }))).toEqual(["att:DEADLINE_DUE", "para:DEADLINE_DUE"]);
  });

  it("never notifies for a satisfied deadline", () => {
    expect(kinds(snapshot({ deadlines: [{ ...deadline, satisfied: true }] }))).toEqual([]);
    expect(kinds(snapshot({ deadlines: [{ ...deadline, satisfied: true, date: new Date("2026-11-01T00:00:00Z") }] }))).toEqual([]);
  });

  it("flags an unsatisfied deadline after its day passes", () => {
    expect(kinds(snapshot({ deadlines: [{ ...deadline, date: new Date("2026-11-08T00:00:00Z") }] }))).toEqual([
      "att:DEADLINE_OVERDUE",
      "para:DEADLINE_OVERDUE",
    ]);
  });
});

describe("events", () => {
  it("reminds creator and attendees within the reminder offset", () => {
    expect(kinds(snapshot({ events: [event()] }))).toEqual(["att:EVENT_REMINDER", "para:EVENT_REMINDER"]);
  });

  it("combines the legacy single reminder with additional offsets", () => {
    expect(eventReminderOffsets({ reminderMinutesBefore: 60, reminderOffsetsMinutes: [15, 60, 1440] })).toEqual([15, 60, 1440]);
    const planned = planNotifications(NOW, snapshot({ events: [event({ reminderOffsetsMinutes: [15] })] }));
    // 30 min out: the 60-minute reminder is due, the 15-minute one isn't yet.
    expect(new Set(planned.map((n) => n.dedupeKey.split(":").pop()))).toEqual(new Set(["60"]));
  });

  it("does not remind an attendee who can't access the event's matter", () => {
    expect(kinds(snapshot({ events: [event({ attendeeIds: ["outsider"] })] }))).toEqual(["att:EVENT_REMINDER"]);
  });

  it("internal (matterless) events reach creator and attendees", () => {
    expect(kinds(snapshot({ events: [event({ matterId: null, attendeeIds: ["outsider"] })] }))).toEqual([
      "att:EVENT_REMINDER",
      "outsider:EVENT_REMINDER",
    ]);
  });

  it("never reminds for a cancelled event", () => {
    expect(kinds(snapshot({ events: [event({ status: "CANCELLED" })] }))).toEqual([]);
  });

  it("announces a recent cancellation to everyone except the person who cancelled", () => {
    const cancelled = event({ status: "CANCELLED", updatedAt: new Date(NOW.getTime() - HOUR), lastEditorId: "att" });
    expect(kinds(snapshot({ events: [cancelled] }))).toEqual(["para:EVENT_CANCELLED"]);
  });

  it("announces an edit once per updatedAt, excluding the editor", () => {
    const edited = event({ startTime: new Date(NOW.getTime() + 5 * DAY), updatedAt: new Date(NOW.getTime() - HOUR), lastEditorId: "para" });
    const planned = planNotifications(NOW, snapshot({ events: [edited] }));
    expect(planned).toEqual([expect.objectContaining({ userId: "att", kind: "EVENT_CHANGED", dedupeKey: `event:e1:changed:${edited.updatedAt.toISOString()}` })]);
  });

  it("titles by event type label only", () => {
    expect(planNotifications(NOW, snapshot({ events: [event()] }))[0]!.title).toBe("Event reminder: Hearing");
  });

  describe("recurrence and exceptions", () => {
    // Weekly 10:00 New York, starting before the DST change (Nov 1, 2026).
    const weekly = () =>
      event({
        startTime: new Date("2026-10-27T14:00:00Z"), // 10:00 EDT
        recurrenceFrequency: "WEEKLY",
        reminderMinutesBefore: 120,
      });
    const at = new Date("2026-11-10T14:00:00Z"); // 09:00 EST on Nov 10 → next occurrence 10:00 EST = 15:00Z

    it("reminds for the upcoming occurrence at the same local time across DST", () => {
      const occurrences = upcomingOccurrences(weekly(), at, 2 * HOUR);
      expect(occurrences.map((o) => o.start.toISOString())).toEqual(["2026-11-10T15:00:00.000Z"]);
      const planned = planNotifications(at, snapshot({ events: [weekly()] }));
      expect(planned[0]!.dedupeKey).toBe("event:e1:occ:2026-11-10T15:00:00.000Z:2026-11-10T15:00:00.000Z:120");
    });

    it("skips an occurrence cancelled by an exception", () => {
      const e = weekly();
      e.exceptions = [{ originalStart: new Date("2026-11-10T15:00:00Z"), kind: "CANCELLED", startTime: null }];
      expect(planNotifications(at, snapshot({ events: [e] }))).toEqual([]);
    });

    it("uses a modified occurrence's new start (and re-keys it)", () => {
      const e = weekly();
      e.exceptions = [{ originalStart: new Date("2026-11-10T15:00:00Z"), kind: "MODIFIED", startTime: new Date("2026-11-10T15:30:00Z") }];
      const planned = planNotifications(at, snapshot({ events: [e] }));
      expect(planned[0]!.dedupeKey).toBe("event:e1:occ:2026-11-10T15:00:00.000Z:2026-11-10T15:30:00.000Z:120");
    });
  });
});

describe("direct messages and preferences", () => {
  const conversation = {
    id: "c1",
    lastMessageId: "msg9",
    lastMessageAt: new Date(NOW.getTime() - HOUR),
    lastMessageAuthorId: "att",
    members: [
      { userId: "att", lastReadAt: null },
      { userId: "para", lastReadAt: new Date(NOW.getTime() - DAY) },
      { userId: "admin", lastReadAt: NOW },
    ],
  };

  it("notifies unread members other than the author, keyed to the latest message, with no body", () => {
    const planned = planNotifications(NOW, snapshot({ conversations: [conversation] }));
    expect(planned).toEqual([
      expect.objectContaining({ userId: "para", kind: "CHAT_DIRECT_MESSAGE", dedupeKey: "conv:c1:msg:msg9", title: "New direct message" }),
    ]);
  });

  it("respects a disabled preference", () => {
    expect(planNotifications(NOW, snapshot({ conversations: [conversation], disabled: new Set(["para:CHAT_DIRECT_MESSAGE"]) }))).toEqual([]);
  });

  it("is deterministic: the same snapshot always plans the same keys", () => {
    const s = snapshot({ tasks: [task()], events: [event()], conversations: [conversation] });
    expect(planNotifications(NOW, s)).toEqual(planNotifications(NOW, s));
  });
});
