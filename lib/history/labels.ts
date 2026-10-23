import type {
  CaseDisposition,
  ObservationCategory,
  ObservationKind,
  ObservationShareScope,
  ProceedingType,
  ResolutionProcedure,
  RulingIssueType,
  RulingResult,
  TrialType,
} from "@prisma/client";

/** Display labels for professional history and matter closure. */

function values<T extends string>(labels: Record<T, string>) {
  return Object.keys(labels) as [T, ...T[]];
}

export const PROCEEDING_TYPE_LABELS: Record<ProceedingType, string> = {
  ARRAIGNMENT: "Arraignment",
  BOND_HEARING: "Bond hearing",
  MOTION_HEARING: "Motion hearing",
  PRETRIAL_CONFERENCE: "Pretrial conference",
  PLEA_HEARING: "Plea hearing",
  TRIAL: "Trial",
  SENTENCING: "Sentencing",
  PROBATION_HEARING: "Probation hearing",
  OTHER: "Other proceeding",
};
export const PROCEEDING_TYPE_VALUES = values(PROCEEDING_TYPE_LABELS);

export const RULING_ISSUE_LABELS: Record<RulingIssueType, string> = {
  MOTION_TO_SUPPRESS: "Motion to suppress",
  MOTION_TO_DISMISS: "Motion to dismiss",
  BOND_MODIFICATION: "Bond modification",
  DISCOVERY_MOTION: "Discovery motion",
  EVIDENTIARY_MOTION: "Evidentiary motion",
  CONTINUANCE: "Continuance",
  SENTENCING: "Sentencing",
  PROBATION_MOTION: "Probation-related motion",
  JURY_INSTRUCTION: "Jury instruction issue",
  OTHER_MOTION: "Other motion",
};
export const RULING_ISSUE_VALUES = values(RULING_ISSUE_LABELS);

export const RULING_RESULT_LABELS: Record<RulingResult, string> = {
  GRANTED: "Granted",
  DENIED: "Denied",
  PARTIALLY_GRANTED: "Partially granted",
  WITHDRAWN: "Withdrawn",
  MOOT: "Moot",
  TAKEN_UNDER_ADVISEMENT: "Taken under advisement",
  OTHER: "Other",
};
export const RULING_RESULT_VALUES = values(RULING_RESULT_LABELS);

export const OBSERVATION_KIND_LABELS: Record<ObservationKind, string> = {
  PROCEDURAL_OBSERVATION: "Attorney observation",
  SUBJECTIVE_IMPRESSION: "Subjective impression",
  LESSON_LEARNED: "Lesson learned",
};
export const OBSERVATION_KIND_VALUES = values(OBSERVATION_KIND_LABELS);

export const OBSERVATION_CATEGORY_LABELS: Record<ObservationCategory, string> = {
  HEARING_PROCEDURE: "Hearing procedure",
  SCHEDULING: "Scheduling practices",
  COURTROOM_MANAGEMENT: "Courtroom management",
  EVIDENTIARY: "Evidentiary concerns",
  LEGAL_ISSUE: "Handling of legal issues",
  NEGOTIATION: "Negotiation",
  COMMUNICATION: "Communication preferences",
  PREPARATION: "Preparation recommendations",
  OTHER: "Other",
};
export const OBSERVATION_CATEGORY_VALUES = values(OBSERVATION_CATEGORY_LABELS);

export const SHARE_SCOPE_LABELS: Record<ObservationShareScope, string> = {
  MATTER_ONLY: "Restricted to the matter",
  FIRM_ATTORNEYS: "Firm-wide reference (attorneys)",
};

export const DISPOSITION_LABELS: Record<CaseDisposition, string> = {
  DISMISSAL: "Dismissal",
  ACQUITTAL: "Acquittal",
  CONVICTION: "Conviction",
  PLEA_AGREEMENT: "Plea agreement",
  DIVERSION: "Diversion",
  NOLLE_PROSEQUI: "Nolle prosequi",
  DEFERRED_ADJUDICATION: "Deferred adjudication",
  ADMINISTRATIVE_CLOSURE: "Administrative closure",
  OTHER: "Other disposition",
};
export const DISPOSITION_VALUES = values(DISPOSITION_LABELS);

export const RESOLUTION_LABELS: Record<ResolutionProcedure, string> = {
  TRIAL: "Trial",
  PLEA: "Plea",
  DISMISSAL: "Dismissal",
  DIVERSION: "Diversion",
  OTHER: "Other procedure",
};
export const RESOLUTION_VALUES = values(RESOLUTION_LABELS);

export const TRIAL_TYPE_LABELS: Record<TrialType, string> = { BENCH: "Bench trial", JURY: "Jury trial" };
export const TRIAL_TYPE_VALUES = values(TRIAL_TYPE_LABELS);

export const VERDICT_LABELS = {
  GUILTY: "Guilty",
  NOT_GUILTY: "Not guilty",
  GUILTY_LESSER_INCLUDED: "Guilty of lesser-included offense",
  HUNG_JURY: "Hung jury / mistrial",
  DISMISSED: "Dismissed during trial",
  OTHER: "Other",
} as const;
export type Verdict = keyof typeof VERDICT_LABELS;
export const VERDICT_VALUES = Object.keys(VERDICT_LABELS) as [Verdict, ...Verdict[]];
