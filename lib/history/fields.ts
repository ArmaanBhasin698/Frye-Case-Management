import { z } from "zod";

import {
  DISPOSITION_VALUES,
  OBSERVATION_CATEGORY_VALUES,
  OBSERVATION_KIND_VALUES,
  PROCEEDING_TYPE_VALUES,
  RESOLUTION_VALUES,
  RULING_ISSUE_VALUES,
  RULING_RESULT_VALUES,
  TRIAL_TYPE_VALUES,
  VERDICT_VALUES,
} from "@/lib/history/labels";

/**
 * Validation for rulings, observations, and closure reports. A plain
 * module (not "use server") so it's unit-testable and never directly
 * network-callable.
 */

const id = z.string().trim().min(1, "Required.").max(100);
const optionalId = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => (v ? v : undefined));
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long.`)
    .optional()
    .transform((v) => (v ? v : undefined));
const requiredText = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);
const date = (label: string) =>
  z
    .string()
    .min(1, `${label} is required.`)
    .refine((v) => !Number.isNaN(Date.parse(v)), `Invalid ${label.toLowerCase()}.`);
const optionalDate = (label: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), `Invalid ${label.toLowerCase()}.`);

export const rulingFieldsSchema = z.object({
  matterId: id,
  judgeContactId: id,
  rulingDate: date("Ruling date"),
  court: requiredText(200, "Court"),
  proceedingType: z.enum(PROCEEDING_TYPE_VALUES),
  issueType: z.enum(RULING_ISSUE_VALUES),
  issueDetail: optionalText(300, "Issue detail"),
  result: z.enum(RULING_RESULT_VALUES),
  context: optionalText(5_000, "Context"),
  documentId: optionalId,
});
export type RulingFields = z.infer<typeof rulingFieldsSchema>;

export function readRulingFields(formData: FormData) {
  const get = (k: string) => (formData.get(k) === null ? undefined : String(formData.get(k)));
  return rulingFieldsSchema.safeParse({
    matterId: get("matterId"),
    judgeContactId: get("judgeContactId"),
    rulingDate: get("rulingDate"),
    court: get("court"),
    proceedingType: get("proceedingType"),
    issueType: get("issueType"),
    issueDetail: get("issueDetail"),
    result: get("result"),
    context: get("context"),
    documentId: get("documentId"),
  });
}

export const observationFieldsSchema = z
  .object({
    subjectContactId: id,
    matterId: optionalId,
    category: z.enum(OBSERVATION_CATEGORY_VALUES),
    kind: z.enum(OBSERVATION_KIND_VALUES),
    body: requiredText(5_000, "Observation"),
    references: optionalText(1_000, "References"),
    shareScope: z.enum(["MATTER_ONLY", "FIRM_ATTORNEYS"]),
    confirmNoPrivileged: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (d.shareScope === "MATTER_ONLY" && !d.matterId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the matter this observation belongs to.", path: ["matterId"] });
    }
    if (d.shareScope === "FIRM_ATTORNEYS" && !d.confirmNoPrivileged) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Firm-wide notes must not contain privileged or matter-specific information — confirm before sharing.",
        path: ["confirmNoPrivileged"],
      });
    }
  })
  // A firm-wide reference note never carries a matter, so it can't disclose one.
  .transform((d) => (d.shareScope === "FIRM_ATTORNEYS" ? { ...d, matterId: undefined } : d));
export type ObservationFields = z.infer<typeof observationFieldsSchema>;

export function readObservationFields(formData: FormData, prefix = "") {
  const get = (k: string) => {
    const v = formData.get(prefix + k);
    return v === null ? undefined : String(v);
  };
  return observationFieldsSchema.safeParse({
    subjectContactId: get("subjectContactId"),
    matterId: get("matterId"),
    category: get("category"),
    kind: get("kind"),
    body: get("body"),
    references: get("references"),
    shareScope: get("shareScope") ?? "MATTER_ONLY",
    confirmNoPrivileged: get("confirmNoPrivileged") === "on",
  });
}

const verdictSchema = z.object({ charge: requiredText(300, "Charge"), verdict: z.enum(VERDICT_VALUES) });
export type VerdictRow = z.infer<typeof verdictSchema>;

const trialSchema = z
  .object({
    trialStartDate: date("Trial start date"),
    trialEndDate: optionalDate("Trial end date"),
    trialType: z.enum(TRIAL_TYPE_VALUES),
    defenseAttorneys: optionalText(500, "Defense attorneys"),
    chargesTried: requiredText(2_000, "Charges tried"),
    verdicts: z.array(verdictSchema).min(1, "Record the verdict for at least one charge."),
    evidentiaryIssues: optionalText(5_000, "Evidentiary issues"),
    significantMotions: optionalText(5_000, "Significant motions"),
    sentencingOutcome: optionalText(2_000, "Sentencing outcome"),
    trialSummary: requiredText(10_000, "Trial summary"),
    attorneyObservations: optionalText(5_000, "Attorney observations"),
    lessonsLearned: optionalText(5_000, "Lessons learned"),
  })
  .refine((t) => !t.trialEndDate || new Date(t.trialEndDate) >= new Date(t.trialStartDate), {
    message: "Trial end date must be on or after the start date.",
    path: ["trialEndDate"],
  });
export type TrialFields = z.infer<typeof trialSchema>;

export const closureFieldsSchema = z
  .object({
    matterId: id,
    responsibleAttorneyId: optionalId,
    closureDate: date("Closure date"),
    caseType: optionalText(200, "Case type"),
    charges: requiredText(2_000, "Charges"),
    disposition: z.enum(DISPOSITION_VALUES),
    dispositionDetail: optionalText(1_000, "Disposition detail"),
    outcomeDate: optionalDate("Outcome date"),
    resolutionProcedure: z.enum(RESOLUTION_VALUES),
    outcomeSummary: requiredText(10_000, "Outcome summary"),
    judgeContactId: optionalId,
    prosecutorContactId: optionalId,
    opposingCounselContactId: optionalId,
    noSignificantRulings: z.boolean(),
    exceptionReason: optionalText(2_000, "Exception reason"),
    finalNotes: optionalText(10_000, "Final notes"),
    lessonsLearned: optionalText(10_000, "Lessons learned"),
    reviewedObservations: z.boolean(),
    amendmentReason: optionalText(2_000, "Amendment reason"),
    trial: trialSchema.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.disposition === "ADMINISTRATIVE_CLOSURE" && !d.exceptionReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An administrative closure needs a documented reason.",
        path: ["exceptionReason"],
      });
    }
    if (d.resolutionProcedure === "TRIAL" && !d.trial) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Complete the trial report.", path: ["trial"] });
    }
    if (!d.reviewedObservations) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Confirm you have reviewed the professional-history observations for this matter.",
        path: ["reviewedObservations"],
      });
    }
  });
export type ClosureFields = z.infer<typeof closureFieldsSchema>;

function readVerdicts(formData: FormData): VerdictRow[] {
  const charges = formData.getAll("verdictCharge").map(String);
  const verdicts = formData.getAll("verdictResult").map(String);
  return charges
    .map((charge, i) => ({ charge: charge.trim(), verdict: verdicts[i] ?? "" }))
    .filter((row) => row.charge.length > 0) as VerdictRow[];
}

/**
 * Trial fields are only read — and therefore only required — when the
 * resolution procedure is TRIAL; a plea or dismissal never has to fill
 * them in.
 */
export function readClosureFields(formData: FormData) {
  const get = (k: string) => (formData.get(k) === null ? undefined : String(formData.get(k)));
  const resolutionProcedure = get("resolutionProcedure");
  return closureFieldsSchema.safeParse({
    matterId: get("matterId"),
    responsibleAttorneyId: get("responsibleAttorneyId"),
    closureDate: get("closureDate"),
    caseType: get("caseType"),
    charges: get("charges"),
    disposition: get("disposition"),
    dispositionDetail: get("dispositionDetail"),
    outcomeDate: get("outcomeDate"),
    resolutionProcedure,
    outcomeSummary: get("outcomeSummary"),
    judgeContactId: get("judgeContactId"),
    prosecutorContactId: get("prosecutorContactId"),
    opposingCounselContactId: get("opposingCounselContactId"),
    noSignificantRulings: get("noSignificantRulings") === "on",
    exceptionReason: get("exceptionReason"),
    finalNotes: get("finalNotes"),
    lessonsLearned: get("lessonsLearned"),
    reviewedObservations: get("reviewedObservations") === "on",
    amendmentReason: get("amendmentReason"),
    trial:
      resolutionProcedure === "TRIAL"
        ? {
            trialStartDate: get("trialStartDate") ?? "",
            trialEndDate: get("trialEndDate"),
            trialType: get("trialType"),
            defenseAttorneys: get("defenseAttorneys"),
            chargesTried: get("chargesTried") ?? "",
            verdicts: readVerdicts(formData),
            evidentiaryIssues: get("evidentiaryIssues"),
            significantMotions: get("significantMotions"),
            sentencingOutcome: get("sentencingOutcome"),
            trialSummary: get("trialSummary") ?? "",
            attorneyObservations: get("attorneyObservations"),
            lessonsLearned: get("trialLessonsLearned"),
          }
        : undefined,
  });
}

/**
 * Closure can't proceed unless significant rulings are accounted for:
 * at least one ruling is recorded on the matter, or the attorney
 * explicitly states none were significant, or a documented exception
 * (e.g. incomplete historical data) explains why not.
 */
export function rulingsAccountedFor(fields: Pick<ClosureFields, "noSignificantRulings" | "exceptionReason">, rulingCount: number) {
  return rulingCount > 0 || fields.noSignificantRulings || Boolean(fields.exceptionReason);
}
