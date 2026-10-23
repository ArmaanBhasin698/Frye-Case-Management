import type { CalendarEventType, NotificationKind, RecurrenceFrequency, TaskStatus } from "@prisma/client";

import { expandOccurrences } from "@/lib/calendar/recurrence";
import { calendarEventTypeLabel } from "@/lib/matters/format";
import { DEFAULT_TASK_REMINDER_MINUTES, NOTIFICATION_KIND_LABELS } from "@/lib/notifications/labels";

/**
 * Pure notification planner: given a snapshot of the firm's tasks,
 * deadlines, events, and direct-message state at `now`, returns every
 * notification that *should exist*. The scheduler inserts them with
 * `skipDuplicates` on (userId, dedupeKey), so re-running the planner —
 * after a crash, on overlapping runs, or every few minutes — never
 * duplicates anything, and a changed due date / start time produces a new
 * dedupe key (re-arming the reminder) instead of silently reusing the old.
 *
 * Recipients must have access at planning time (matter assignment or
 * ADMIN for matter records; creator/attendee for internal events; active
 * membership for conversations). Access is re-checked again whenever a
 * notification is listed, counted, or opened (lib/notifications/queries.ts).
 * Titles are generic labels — never task, event, or message text.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** How far back "assigned"/"changed"/"cancelled"/DM activity still notifies. */
export const RECENT_ACTIVITY_WINDOW_MS = 7 * DAY;
/** How long an overdue item keeps being eligible for its single overdue notice. */
export const OVERDUE_WINDOW_MS = 30 * DAY;

export type PlannerUser = { id: string; isAdmin: boolean; assignedMatterIds: ReadonlySet<string> };

export type PlannerTask = {
  id: string;
  matterId: string;
  assignedToId: string | null;
  dueDate: Date | null;
  status: TaskStatus;
  reminderOffsetsMinutes: number[];
  updatedAt: Date;
};

export type PlannerDeadline = {
  id: string;
  matterId: string;
  date: Date;
  reminderDaysBefore: number;
  satisfied: boolean;
  /** Users assigned to the deadline's matter — the people responsible for it. */
  recipientIds: string[];
};

export type PlannerEventException = { originalStart: Date; kind: "CANCELLED" | "MODIFIED"; startTime: Date | null };

export type PlannerEvent = {
  id: string;
  matterId: string | null;
  type: CalendarEventType;
  status: "SCHEDULED" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
  createdById: string | null;
  attendeeIds: string[];
  startTime: Date;
  endTime: Date | null;
  timeZone: string;
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceInterval: number;
  recurrenceUntil: Date | null;
  recurrenceCount: number | null;
  reminderMinutesBefore: number | null;
  reminderOffsetsMinutes: number[];
  createdAt: Date;
  updatedAt: Date;
  /** Who made the most recent change, so they aren't notified of their own edit. */
  lastEditorId: string | null;
  exceptions: PlannerEventException[];
};

export type PlannerConversation = {
  id: string;
  lastMessageId: string;
  lastMessageAt: Date;
  lastMessageAuthorId: string | null;
  /** Active members only. */
  members: { userId: string; lastReadAt: Date | null }[];
};

export type PlannerSnapshot = {
  users: Map<string, PlannerUser>;
  tasks: PlannerTask[];
  deadlines: PlannerDeadline[];
  events: PlannerEvent[];
  conversations: PlannerConversation[];
  /** `${userId}:${kind}` for kinds a user has turned off. */
  disabled: ReadonlySet<string>;
};

export type PlannedNotification = {
  userId: string;
  kind: NotificationKind;
  dedupeKey: string;
  title: string;
  entityType: "Task" | "Deadline" | "CalendarEvent" | "ChatConversation";
  entityId: string;
  matterId: string | null;
};

function canSeeMatter(user: PlannerUser | undefined, matterId: string): user is PlannerUser {
  return user !== undefined && (user.isAdmin || user.assignedMatterIds.has(matterId));
}

function canSeeEvent(user: PlannerUser | undefined, event: PlannerEvent): user is PlannerUser {
  if (!user) return false;
  if (event.matterId) return canSeeMatter(user, event.matterId);
  return user.isAdmin || event.createdById === user.id || event.attendeeIds.includes(user.id);
}

const iso = (d: Date) => d.toISOString();

function planTasks(now: number, snapshot: PlannerSnapshot, out: PlannedNotification[]) {
  for (const task of snapshot.tasks) {
    if (task.status === "DONE" || task.status === "CANCELLED" || !task.assignedToId) continue;
    const user = snapshot.users.get(task.assignedToId);
    if (!canSeeMatter(user, task.matterId)) continue;
    const base = { userId: user.id, entityType: "Task" as const, entityId: task.id, matterId: task.matterId };

    if (now - task.updatedAt.getTime() <= RECENT_ACTIVITY_WINDOW_MS) {
      out.push({ ...base, kind: "TASK_ASSIGNED", dedupeKey: `task:${task.id}:assignee:${user.id}`, title: NOTIFICATION_KIND_LABELS.TASK_ASSIGNED });
    }
    if (!task.dueDate) continue;

    // A due date is a calendar day: it is due from the start of that day
    // and overdue once the whole day has passed.
    const due = task.dueDate.getTime();
    const overdueAt = due + DAY;
    const offsets = task.reminderOffsetsMinutes.length > 0 ? task.reminderOffsetsMinutes : [DEFAULT_TASK_REMINDER_MINUTES];
    for (const offset of new Set(offsets)) {
      if (now >= due - offset * MINUTE && now < overdueAt) {
        out.push({ ...base, kind: "TASK_DUE", dedupeKey: `task:${task.id}:due:${iso(task.dueDate)}:${offset}`, title: NOTIFICATION_KIND_LABELS.TASK_DUE });
      }
    }
    if (now >= overdueAt && now - overdueAt <= OVERDUE_WINDOW_MS) {
      out.push({ ...base, kind: "TASK_OVERDUE", dedupeKey: `task:${task.id}:overdue:${iso(task.dueDate)}`, title: NOTIFICATION_KIND_LABELS.TASK_OVERDUE });
    }
  }
}

function planDeadlines(now: number, snapshot: PlannerSnapshot, out: PlannedNotification[]) {
  for (const deadline of snapshot.deadlines) {
    if (deadline.satisfied) continue;
    const day = deadline.date.getTime();
    const fireAt = day - Math.max(0, deadline.reminderDaysBefore) * DAY;
    const passedAt = day + DAY;
    for (const userId of new Set(deadline.recipientIds)) {
      if (!canSeeMatter(snapshot.users.get(userId), deadline.matterId)) continue;
      const base = { userId, entityType: "Deadline" as const, entityId: deadline.id, matterId: deadline.matterId };
      if (now >= fireAt && now < passedAt) {
        out.push({
          ...base,
          kind: "DEADLINE_DUE",
          dedupeKey: `deadline:${deadline.id}:due:${iso(deadline.date)}:${deadline.reminderDaysBefore}`,
          title: NOTIFICATION_KIND_LABELS.DEADLINE_DUE,
        });
      }
      if (now >= passedAt && now - passedAt <= OVERDUE_WINDOW_MS) {
        out.push({ ...base, kind: "DEADLINE_OVERDUE", dedupeKey: `deadline:${deadline.id}:overdue:${iso(deadline.date)}`, title: NOTIFICATION_KIND_LABELS.DEADLINE_OVERDUE });
      }
    }
  }
}

/** Every reminder offset an event carries (legacy single value + additional offsets). */
export function eventReminderOffsets(event: Pick<PlannerEvent, "reminderMinutesBefore" | "reminderOffsetsMinutes">): number[] {
  const all = [...event.reminderOffsetsMinutes, ...(event.reminderMinutesBefore != null ? [event.reminderMinutesBefore] : [])];
  return [...new Set(all.filter((m) => Number.isInteger(m) && m >= 0))].sort((a, b) => a - b);
}

/**
 * Occurrences of `event`, with per-occurrence exceptions applied, whose
 * effective start falls in (now, now + horizon]. CANCELLED exceptions drop
 * the occurrence; MODIFIED ones move it. Identity stays the original start.
 */
export function upcomingOccurrences(event: PlannerEvent, now: Date, horizonMs: number) {
  const exceptions = new Map(event.exceptions.map((e) => [e.originalStart.getTime(), e]));
  // Look back by the horizon as well, so an occurrence an exception moved
  // *later* into the window is still found.
  const raw = expandOccurrences(event, new Date(now.getTime() - horizonMs), new Date(now.getTime() + horizonMs + 1));
  const result: { originalStart: Date; start: Date }[] = [];
  for (const occurrence of raw) {
    const exception = exceptions.get(occurrence.start.getTime());
    if (exception?.kind === "CANCELLED") continue;
    const start = exception?.kind === "MODIFIED" && exception.startTime ? exception.startTime : occurrence.start;
    if (start.getTime() > now.getTime() && start.getTime() <= now.getTime() + horizonMs) {
      result.push({ originalStart: occurrence.start, start });
    }
  }
  return result;
}

function eventRecipients(event: PlannerEvent, snapshot: PlannerSnapshot): PlannerUser[] {
  const ids = new Set([...(event.createdById ? [event.createdById] : []), ...event.attendeeIds]);
  return [...ids].map((id) => snapshot.users.get(id)).filter((u): u is PlannerUser => canSeeEvent(u, event));
}

function planEvents(nowDate: Date, snapshot: PlannerSnapshot, out: PlannedNotification[]) {
  const now = nowDate.getTime();
  for (const event of snapshot.events) {
    const recipients = eventRecipients(event, snapshot);
    if (recipients.length === 0) continue;
    const base = { entityType: "CalendarEvent" as const, entityId: event.id, matterId: event.matterId };
    const recent = now - event.updatedAt.getTime() <= RECENT_ACTIVITY_WINDOW_MS;

    if (event.status === "CANCELLED") {
      // Only worth announcing if the event hadn't already happened.
      if (recent && event.startTime.getTime() >= now - DAY) {
        for (const user of recipients) {
          if (user.id === event.lastEditorId) continue;
          out.push({ ...base, userId: user.id, kind: "EVENT_CANCELLED", dedupeKey: `event:${event.id}:cancelled`, title: NOTIFICATION_KIND_LABELS.EVENT_CANCELLED });
        }
      }
      continue;
    }

    const edited = event.updatedAt.getTime() - event.createdAt.getTime() > MINUTE;
    if (recent && edited) {
      for (const user of recipients) {
        if (user.id === event.lastEditorId) continue;
        out.push({ ...base, userId: user.id, kind: "EVENT_CHANGED", dedupeKey: `event:${event.id}:changed:${iso(event.updatedAt)}`, title: NOTIFICATION_KIND_LABELS.EVENT_CHANGED });
      }
    }

    if (event.status === "COMPLETED") continue;
    const offsets = eventReminderOffsets(event);
    if (offsets.length === 0) continue;
    const horizon = Math.max(...offsets) * MINUTE;
    for (const occurrence of upcomingOccurrences(event, nowDate, horizon)) {
      for (const offset of offsets) {
        if (now < occurrence.start.getTime() - offset * MINUTE) continue;
        for (const user of recipients) {
          out.push({
            ...base,
            userId: user.id,
            kind: "EVENT_REMINDER",
            dedupeKey: `event:${event.id}:occ:${iso(occurrence.originalStart)}:${iso(occurrence.start)}:${offset}`,
            title: `Event reminder: ${calendarEventTypeLabel(event.type)}`,
          });
        }
      }
    }
  }
}

function planDirectMessages(now: number, snapshot: PlannerSnapshot, out: PlannedNotification[]) {
  for (const conversation of snapshot.conversations) {
    if (now - conversation.lastMessageAt.getTime() > RECENT_ACTIVITY_WINDOW_MS) continue;
    for (const member of conversation.members) {
      if (member.userId === conversation.lastMessageAuthorId) continue;
      if (member.lastReadAt && member.lastReadAt >= conversation.lastMessageAt) continue;
      if (!snapshot.users.has(member.userId)) continue;
      out.push({
        userId: member.userId,
        kind: "CHAT_DIRECT_MESSAGE",
        dedupeKey: `conv:${conversation.id}:msg:${conversation.lastMessageId}`,
        title: NOTIFICATION_KIND_LABELS.CHAT_DIRECT_MESSAGE,
        entityType: "ChatConversation",
        entityId: conversation.id,
        matterId: null,
      });
    }
  }
}

export function planNotifications(now: Date, snapshot: PlannerSnapshot): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  planTasks(now.getTime(), snapshot, out);
  planDeadlines(now.getTime(), snapshot, out);
  planEvents(now, snapshot, out);
  planDirectMessages(now.getTime(), snapshot, out);
  const seen = new Set<string>();
  return out.filter((n) => {
    if (snapshot.disabled.has(`${n.userId}:${n.kind}`)) return false;
    const key = `${n.userId}|${n.dedupeKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
