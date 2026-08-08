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
