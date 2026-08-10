import { differenceInCalendarDays } from "date-fns";
import type {
  AssignmentRole,
  CalendarEventType,
  CallDirection,
  DeadlineType,
  DiscoveryFileType,
  DiscoveryMatchStatus,
  DiscoveryReviewStatus,
  DocumentCategory,
  MatterStatus,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";
import type { BadgeProps } from "@/components/ui/badge";

/**
 * Date-only fields (Deadline.date, Task.dueDate, Matter.openedDate/
 * closedDate, Client.dateOfBirth, DiscoveryProduction.receivedDate) are
 * written from a `<input type="date">` value via `new Date("2026-08-10")`,
 * which the ECMA-262 date-only grammar parses as UTC midnight — the column
 * holds an instant, but the app only ever cares about its calendar day.
 * date-fns' `format`/`isPast`/`isToday`/`differenceInCalendarDays` all read
 * the *local* wall-clock day, which is the previous day in any time zone
 * behind UTC. Re-anchoring the stored instant's UTC year/month/day to local
 * midnight before handing it to date-fns makes those calls render the same
 * calendar day that was selected, regardless of server/browser time zone.
 * Never use this on a true instant (CalendarEvent start/end times, call
 * times, createdAt/updatedAt, audit timestamps) — those must keep reading
 * in local time.
 */
export function asCalendarDate(date: Date): Date {
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Today's local calendar day, encoded the same way a date-only column is
 * written (UTC midnight of that Y/M/D — see `asCalendarDate` above).
 * "Upcoming"/"overdue" queries that compare Deadline.date or Task.dueDate
 * against a true instant (`new Date()`) treat an item due today as already
 * past for most of the local day in any time zone behind UTC, since the
 * stored value is UTC midnight while the current instant has already
 * advanced hours into that UTC day. Compare date-only columns against this
 * instead of `new Date()` so "due today" holds for the full local calendar
 * day. Never use this for a true-instant comparison (CalendarEvent
 * start/end, Call.occurredAt, createdAt/updatedAt, audit timestamps) — use
 * `new Date()` there.
 */
export function todayAsStoredDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function formatClientName(client: { firstName: string; lastName: string }) {
  return `${client.firstName} ${client.lastName}`;
}

export function matterTitle(matter: {
  caseNumber: string;
  client: { firstName: string; lastName: string };
}) {
  return `State v. ${matter.client.lastName}`;
}

const MATTER_STATUS_LABEL: Record<MatterStatus, string> = {
  OPEN: "Open",
  PENDING: "Pending",
  CLOSED: "Closed",
};

const MATTER_STATUS_VARIANT: Record<MatterStatus, BadgeProps["variant"]> = {
  OPEN: "success",
  PENDING: "warning",
  CLOSED: "secondary",
};

export function matterStatusLabel(status: MatterStatus) {
  return MATTER_STATUS_LABEL[status];
}

export function matterStatusVariant(status: MatterStatus): BadgeProps["variant"] {
  return MATTER_STATUS_VARIANT[status];
}

const ASSIGNMENT_ROLE_LABEL: Record<AssignmentRole, string> = {
  LEAD_ATTORNEY: "Lead Attorney",
  ASSOCIATE_ATTORNEY: "Associate Attorney",
  PARALEGAL: "Paralegal",
  STAFF: "Staff",
};

export function assignmentRoleLabel(role: AssignmentRole) {
  return ASSIGNMENT_ROLE_LABEL[role];
}

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

const TASK_STATUS_VARIANT: Record<TaskStatus, BadgeProps["variant"]> = {
  OPEN: "outline",
  IN_PROGRESS: "warning",
  DONE: "success",
  CANCELLED: "secondary",
};

export function taskStatusLabel(status: TaskStatus) {
  return TASK_STATUS_LABEL[status];
}

export function taskStatusVariant(status: TaskStatus): BadgeProps["variant"] {
  return TASK_STATUS_VARIANT[status];
}

const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
};

export function taskPriorityLabel(priority: TaskPriority) {
  return TASK_PRIORITY_LABEL[priority];
}

const DEADLINE_TYPE_LABEL: Record<DeadlineType, string> = {
  STATUTE_OF_LIMITATIONS: "Statute of Limitations",
  SPEEDY_TRIAL: "Speedy Trial",
  FILING: "Filing Deadline",
  OTHER: "Other",
};

export function deadlineTypeLabel(type: DeadlineType) {
  return DEADLINE_TYPE_LABEL[type];
}

const DISCOVERY_FILE_TYPE_LABEL: Record<DiscoveryFileType, string> = {
  PDF: "PDF",
  VIDEO: "Video",
  AUDIO: "Audio",
  PHOTO: "Photo",
  OTHER: "Other",
};

export function discoveryFileTypeLabel(type: DiscoveryFileType) {
  return DISCOVERY_FILE_TYPE_LABEL[type];
}

const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  PLEADING: "Pleading",
  CORRESPONDENCE: "Correspondence",
  CONTRACT: "Contract",
  OTHER: "Other",
};

export function documentCategoryLabel(category: DocumentCategory) {
  return DOCUMENT_CATEGORY_LABEL[category];
}

const CALL_DIRECTION_LABEL: Record<CallDirection, string> = {
  INBOUND: "Inbound",
  OUTBOUND: "Outbound",
};

export function callDirectionLabel(direction: CallDirection) {
  return CALL_DIRECTION_LABEL[direction];
}

/** "DiscoveryProduction" -> "discovery production" for audit timeline copy. */
export function humanizeEntityType(entityType: string) {
  return entityType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** "VIEW" -> "viewed", "CREATE" -> "created" for audit timeline copy. */
export function auditActionPastTense(action: string) {
  const lower = action.toLowerCase();
  return lower.endsWith("e") ? `${lower}d` : `${lower}ed`;
}

const DISCOVERY_REVIEW_STATUS_LABEL: Record<DiscoveryReviewStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_REVIEW: "In Review",
  COMPLETE: "Reviewed",
};

const DISCOVERY_REVIEW_STATUS_VARIANT: Record<DiscoveryReviewStatus, BadgeProps["variant"]> = {
  NOT_STARTED: "outline",
  IN_REVIEW: "warning",
  COMPLETE: "success",
};

export function discoveryReviewStatusLabel(status: DiscoveryReviewStatus) {
  return DISCOVERY_REVIEW_STATUS_LABEL[status];
}

export function discoveryReviewStatusVariant(status: DiscoveryReviewStatus): BadgeProps["variant"] {
  return DISCOVERY_REVIEW_STATUS_VARIANT[status];
}

const DISCOVERY_MATCH_STATUS_LABEL: Record<DiscoveryMatchStatus, string> = {
  NEW: "New",
  CHANGED: "Changed",
  DUPLICATE: "Duplicate",
  MISSING: "Missing",
};

const DISCOVERY_MATCH_STATUS_VARIANT: Record<DiscoveryMatchStatus, BadgeProps["variant"]> = {
  NEW: "success",
  CHANGED: "warning",
  DUPLICATE: "secondary",
  MISSING: "destructive",
};

export function discoveryMatchStatusLabel(status: DiscoveryMatchStatus) {
  return DISCOVERY_MATCH_STATUS_LABEL[status];
}

export function discoveryMatchStatusVariant(status: DiscoveryMatchStatus): BadgeProps["variant"] {
  return DISCOVERY_MATCH_STATUS_VARIANT[status];
}

const CALENDAR_EVENT_TYPE_LABEL: Record<CalendarEventType, string> = {
  HEARING: "Hearing",
  DEPOSITION: "Deposition",
  MEETING: "Meeting",
  OTHER: "Other",
};

export function calendarEventTypeLabel(type: CalendarEventType) {
  return CALENDAR_EVENT_TYPE_LABEL[type];
}

/** "555-0142" style numbers, kept as-is; formats a call's duration as "7 min" / "45 sec". */
export function formatCallDuration(durationSeconds: number) {
  if (durationSeconds < 60) return `${durationSeconds} sec`;
  const minutes = Math.round(durationSeconds / 60);
  return `${minutes} min`;
}

/** 128000 -> "125 KB"; used for registered discovery files' `sizeBytes`. */
export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Calendar days between now and `date` (positive = future). Kept as a
 * standalone helper (rather than inlining `new Date()` in a component) so
 * "now" is only read once per call and never inside render in a way React's
 * purity lint flags.
 */
export function daysUntil(date: Date) {
  return differenceInCalendarDays(date, new Date());
}

/** "Today" / "Tomorrow" / "in 6 days" / "3 days ago" for hero deadline callouts. */
export function formatRelativeDays(date: Date) {
  const days = daysUntil(date);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}
