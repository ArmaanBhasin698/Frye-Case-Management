import type { CalendarEventType, TaskPriority, WorkflowAssigneeRule, WorkflowStepKind } from "@prisma/client";

import { addDaysToKey, parseDateKey, startOfDayUtc, wallTimeToUtc } from "@/lib/calendar/timezone";

/**
 * Pure scheduling for workflow steps. A step's date is the anchor's wall
 * date plus `offsetDays` *calendar* days (no business-day, holiday, or
 * court-rule logic). Tasks get a date-only due date (stored as UTC midnight
 * of that Y/M/D, the existing Task.dueDate convention). Events with a time
 * of day are placed at that wall-clock time in the application's time zone
 * (DST-correct via lib/calendar/timezone); events without one are all-day.
 */

export type StepInput = {
  id: string;
  position: number;
  kind: WorkflowStepKind;
  title: string;
  description: string | null;
  priority: TaskPriority;
  offsetDays: number;
  timeOfDay: string | null;
  durationMinutes: number | null;
  eventType: CalendarEventType | null;
  assigneeRule: WorkflowAssigneeRule;
  assigneeUserId: string | null;
};

export type TeamMember = { userId: string; name: string; role: string; status: string; assignedAt: Date };
export type MatterTeam = { assignments: TeamMember[]; admins: { userId: string; name: string; status: string }[] };

export type ResolvedAssignee = { userId: string | null; name: string | null; note: string | null };

export const DEFAULT_EVENT_MINUTES = 60;

export function parseTimeOfDay(value: string | null | undefined): { hour: number; minute: number } | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export type StepSchedule =
  | { kind: "TASK"; dateKey: string; dueDate: Date }
  | { kind: "EVENT"; dateKey: string; allDay: boolean; startTime: Date; endTime: Date };

export function scheduleStep(
  step: Pick<StepInput, "kind" | "offsetDays" | "timeOfDay" | "durationMinutes">,
  anchorKey: string,
  timeZone: string,
): StepSchedule {
  if (!parseDateKey(anchorKey)) throw new Error("Invalid anchor date.");
  const key = addDaysToKey(anchorKey, step.offsetDays);
  const d = parseDateKey(key)!;
  if (step.kind === "TASK") {
    return { kind: "TASK", dateKey: key, dueDate: new Date(Date.UTC(d.year, d.month - 1, d.day)) };
  }
  const time = parseTimeOfDay(step.timeOfDay);
  if (!time) {
    return {
      kind: "EVENT",
      dateKey: key,
      allDay: true,
      startTime: startOfDayUtc(key, timeZone),
      endTime: startOfDayUtc(addDaysToKey(key, 1), timeZone),
    };
  }
  const startTime = wallTimeToUtc({ ...d, ...time }, timeZone);
  const minutes = step.durationMinutes && step.durationMinutes > 0 ? step.durationMinutes : DEFAULT_EVENT_MINUTES;
  return { kind: "EVENT", dateKey: key, allDay: false, startTime, endTime: new Date(startTime.getTime() + minutes * 60_000) };
}

/**
 * Resolves who a step is assigned to. Only an ACTIVE user who can access
 * the matter (assigned to it, or ADMIN) is ever returned; anything else
 * leaves the item unassigned with a note shown in the preview — the
 * workflow never grants or assumes access.
 */
export function resolveAssignee(
  step: Pick<StepInput, "assigneeRule" | "assigneeUserId">,
  team: MatterTeam,
): ResolvedAssignee {
  const active = team.assignments.filter((a) => a.status === "ACTIVE");
  switch (step.assigneeRule) {
    case "UNASSIGNED":
      return { userId: null, name: null, note: null };
    case "LEAD_ATTORNEY": {
      const lead = active.find((a) => a.role === "LEAD_ATTORNEY");
      return lead
        ? { userId: lead.userId, name: lead.name, note: null }
        : { userId: null, name: null, note: "No active lead attorney on this matter — left unassigned." };
    }
    case "ASSIGNED_PARALEGAL": {
      const paralegal = active
        .filter((a) => a.role === "PARALEGAL")
        .sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime())[0];
      return paralegal
        ? { userId: paralegal.userId, name: paralegal.name, note: null }
        : { userId: null, name: null, note: "No active paralegal on this matter — left unassigned." };
    }
    case "SPECIFIC_USER": {
      const assigned = active.find((a) => a.userId === step.assigneeUserId);
      if (assigned) return { userId: assigned.userId, name: assigned.name, note: null };
      const admin = team.admins.find((a) => a.userId === step.assigneeUserId && a.status === "ACTIVE");
      if (admin) return { userId: admin.userId, name: admin.name, note: null };
      return {
        userId: null,
        name: null,
        note: "The template's staff member can't access this matter — left unassigned.",
      };
    }
  }
}

export type PreviewItem = {
  stepId: string;
  position: number;
  kind: WorkflowStepKind;
  title: string;
  schedule: StepSchedule;
  assignee: ResolvedAssignee;
};

export function buildPreview(steps: StepInput[], anchorKey: string, timeZone: string, team: MatterTeam): PreviewItem[] {
  return [...steps]
    .sort((a, b) => a.position - b.position)
    .map((step) => ({
      stepId: step.id,
      position: step.position,
      kind: step.kind,
      title: step.title,
      schedule: scheduleStep(step, anchorKey, timeZone),
      assignee: resolveAssignee(step, team),
    }));
}

/** Recalculation may move only open work and future, still-scheduled events. */
export function isTaskMovable(status: string): boolean {
  return status === "OPEN" || status === "IN_PROGRESS";
}

export function isEventMovable(event: { status: string; startTime: Date }, now: Date): boolean {
  return (event.status === "SCHEDULED" || event.status === "CONFIRMED") && event.startTime > now;
}
