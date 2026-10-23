import { z } from "zod";

import { TIME_CATEGORY_VALUES } from "@/lib/time/labels";
import { MAX_ENTRY_MINUTES, minutesBetween } from "@/lib/time/math";

/** Time-entry form validation (plain module so it's unit-testable and never network-callable). */

const timeOfDay = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Use HH:MM.")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const timeEntryFieldsSchema = z
  .object({
    matterId: z.string().trim().min(1, "Choose a matter.").max(100),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the work date."),
    startTime: timeOfDay,
    endTime: timeOfDay,
    hours: z.string().optional(),
    minutes: z.string().optional(),
    category: z.enum(TIME_CATEGORY_VALUES),
    description: z.string().trim().min(1, "Describe the work performed.").max(2_000, "Description is too long."),
    billable: z.boolean(),
    hourlyRate: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim() : undefined))
      .refine((v) => !v || /^\d{1,5}(\.\d{1,2})?$/.test(v), "Rate must be a dollar amount."),
  })
  .transform((data, ctx) => {
    let durationMinutes: number;
    let startedAt: Date | null = null;
    let endedAt: Date | null = null;
    if (data.startTime && data.endTime) {
      startedAt = new Date(`${data.workDate}T${data.startTime}:00`);
      endedAt = new Date(`${data.workDate}T${data.endTime}:00`);
      durationMinutes = minutesBetween(startedAt, endedAt);
      if (durationMinutes <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End time must be after start time." });
        return z.NEVER;
      }
    } else {
      const h = Number(data.hours || 0);
      const m = Number(data.minutes || 0);
      if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid duration." });
        return z.NEVER;
      }
      durationMinutes = Math.round(h * 60 + m);
    }
    if (durationMinutes < 1 || durationMinutes > MAX_ENTRY_MINUTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duration must be between 1 minute and 24 hours." });
      return z.NEVER;
    }
    return {
      matterId: data.matterId,
      workDate: new Date(`${data.workDate}T12:00:00`),
      startedAt,
      endedAt,
      durationMinutes,
      category: data.category,
      description: data.description,
      billable: data.billable,
      hourlyRateCents: data.hourlyRate ? Math.round(Number(data.hourlyRate) * 100) : null,
    };
  });

export type TimeEntryFields = z.output<typeof timeEntryFieldsSchema>;

export function readTimeEntryFields(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v === null ? undefined : String(v);
  };
  return timeEntryFieldsSchema.safeParse({
    matterId: get("matterId"),
    workDate: get("workDate"),
    startTime: get("startTime") ?? "",
    endTime: get("endTime") ?? "",
    hours: get("hours"),
    minutes: get("minutes"),
    category: get("category"),
    description: get("description"),
    billable: formData.get("billable") === "on" || formData.get("billable") === "true",
    hourlyRate: get("hourlyRate"),
  });
}
