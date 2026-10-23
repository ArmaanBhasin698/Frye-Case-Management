import type { NotificationKind } from "@prisma/client";

/** Generic, content-free notification labels — never task/event/message text. */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  TASK_ASSIGNED: "Task assigned to you",
  TASK_DUE: "Task due soon",
  TASK_OVERDUE: "Task overdue",
  DEADLINE_DUE: "Deadline approaching",
  DEADLINE_OVERDUE: "Deadline passed without being marked satisfied",
  EVENT_REMINDER: "Upcoming event",
  EVENT_CHANGED: "Event updated",
  EVENT_CANCELLED: "Event cancelled",
  CHAT_DIRECT_MESSAGE: "New direct message",
};

export const NOTIFICATION_KIND_VALUES = Object.keys(NOTIFICATION_KIND_LABELS) as [NotificationKind, ...NotificationKind[]];

/** Reminder offsets offered on task forms (minutes before the due date). */
export const TASK_REMINDER_OFFSET_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 60, label: "1 hour before" },
  { minutes: 24 * 60, label: "1 day before" },
  { minutes: 2 * 24 * 60, label: "2 days before" },
  { minutes: 7 * 24 * 60, label: "1 week before" },
];
export const ALLOWED_TASK_REMINDER_OFFSETS: ReadonlySet<number> = new Set(TASK_REMINDER_OFFSET_OPTIONS.map((o) => o.minutes));

/** Used when a task has a due date but no explicit reminder offsets. */
export const DEFAULT_TASK_REMINDER_MINUTES = 24 * 60;

/** Parses submitted reminder-offset checkboxes, keeping only allowed values. */
export function readTaskReminderOffsets(values: FormDataEntryValue[]): number[] | null {
  const offsets = values.map((v) => Number(v));
  if (offsets.some((m) => !ALLOWED_TASK_REMINDER_OFFSETS.has(m))) return null;
  return [...new Set(offsets)].sort((a, b) => a - b);
}
