import { z } from "zod";

import { isValidTimeZone, parseDateKey } from "@/lib/calendar/timezone";
import { WORKFLOW_ASSIGNEE_RULE_VALUES, WORKFLOW_CATEGORY_VALUES } from "@/lib/workflows/labels";
import { parseTimeOfDay } from "@/lib/workflows/schedule";

/**
 * Validation for workflow templates and applications. Steps arrive as one
 * JSON array (the editor's ordered list), validated here — array order is
 * the step order.
 */

const CALENDAR_EVENT_TYPES = [
  "HEARING",
  "DEPOSITION",
  "MEETING",
  "OTHER",
  "CLIENT_MEETING",
  "INTERNAL_MEETING",
  "TRIAL",
  "CONSULTATION",
  "VIRTUAL_MEETING",
  "PHONE_CALL",
  "FILING_DEADLINE",
  "DISCOVERY_DEADLINE",
] as const;

export const MAX_STEPS = 50;
export const MAX_OFFSET_DAYS = 3650;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const stepSchema = z
  .object({
    kind: z.enum(["TASK", "EVENT"]),
    title: z.string().trim().min(1, "Every step needs a title.").max(200, "Step title is too long."),
    description: optionalText(2_000),
    priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
    offsetDays: z.coerce
      .number()
      .int("Offsets must be whole calendar days.")
      .min(-MAX_OFFSET_DAYS, "Offset is too large.")
      .max(MAX_OFFSET_DAYS, "Offset is too large."),
    timeOfDay: optionalText(5).refine((v) => v === null || parseTimeOfDay(v) !== null, "Times must be HH:mm."),
    durationMinutes: z.coerce.number().int().min(5).max(24 * 60).nullish().transform((v) => v ?? null),
    eventType: z.enum(CALENDAR_EVENT_TYPES).nullish().transform((v) => v ?? null),
    assigneeRule: z.enum(WORKFLOW_ASSIGNEE_RULE_VALUES).default("UNASSIGNED"),
    assigneeUserId: optionalText(100),
  })
  .superRefine((s, ctx) => {
    if (s.assigneeRule === "SPECIFIC_USER" && !s.assigneeUserId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the staff member for a specific-user step." });
    }
  })
  .transform((s) => ({
    ...s,
    // Event-only fields are meaningless on tasks; specific user only for that rule.
    timeOfDay: s.kind === "EVENT" ? s.timeOfDay : null,
    durationMinutes: s.kind === "EVENT" ? s.durationMinutes : null,
    eventType: s.kind === "EVENT" ? (s.eventType ?? "OTHER") : null,
    assigneeUserId: s.assigneeRule === "SPECIFIC_USER" ? s.assigneeUserId : null,
  }));
export type StepFields = z.infer<typeof stepSchema>;

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(150, "Name is too long."),
  description: optionalText(2_000),
  category: z.enum(WORKFLOW_CATEGORY_VALUES),
  steps: z.array(stepSchema).min(1, "Add at least one step.").max(MAX_STEPS, `At most ${MAX_STEPS} steps.`),
});
export type TemplateFields = z.infer<typeof templateSchema>;

export function readTemplateFields(formData: FormData) {
  let steps: unknown = [];
  try {
    steps = JSON.parse(String(formData.get("steps") ?? "[]"));
  } catch {
    steps = null;
  }
  return templateSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description"),
    category: formData.get("category") ?? "OTHER",
    steps,
  });
}

export const anchorSchema = z.object({
  anchorDate: z.string().refine((v) => parseDateKey(v) !== null, "Choose a valid anchor date."),
  timeZone: z.string().refine(isValidTimeZone, "Choose a valid time zone."),
});

export const applySchema = anchorSchema.extend({
  matterId: z.string().trim().min(1).max(100),
  templateVersionId: z.string().trim().min(1).max(100),
  requestKey: z.string().trim().min(8).max(100),
});

export const WORKFLOW_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;
