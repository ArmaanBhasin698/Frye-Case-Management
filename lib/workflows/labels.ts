import type { WorkflowAssigneeRule, WorkflowCategory, WorkflowStepKind } from "@prisma/client";

export const WORKFLOW_CATEGORY_LABELS: Record<WorkflowCategory, string> = {
  RETAINED_CLIENT_SETUP: "Retained-client setup",
  DISCOVERY_REVIEW: "Discovery review",
  HEARING_PREPARATION: "Hearing preparation",
  TRIAL_PREPARATION: "Trial preparation",
  CLOSURE_FOLLOW_UP: "Closure follow-up",
  OTHER: "Other",
};
export const WORKFLOW_CATEGORY_VALUES = Object.keys(WORKFLOW_CATEGORY_LABELS) as [WorkflowCategory, ...WorkflowCategory[]];

export const WORKFLOW_ASSIGNEE_RULE_LABELS: Record<WorkflowAssigneeRule, string> = {
  UNASSIGNED: "Unassigned",
  LEAD_ATTORNEY: "Matter's lead attorney",
  ASSIGNED_PARALEGAL: "Matter's paralegal",
  SPECIFIC_USER: "A specific staff member",
};
export const WORKFLOW_ASSIGNEE_RULE_VALUES = Object.keys(WORKFLOW_ASSIGNEE_RULE_LABELS) as [
  WorkflowAssigneeRule,
  ...WorkflowAssigneeRule[],
];

export const WORKFLOW_STEP_KIND_LABELS: Record<WorkflowStepKind, string> = { TASK: "Task", EVENT: "Calendar event" };

/** Shown wherever offsets are entered or previewed — offsets are never court-rule deadlines. */
export const OFFSET_DISCLAIMER =
  "Offsets are plain calendar days from the anchor date — no court rules, business days, or holidays are applied, and nothing generated is a legal deadline.";
