import type { TimeActivityCategory } from "@prisma/client";

export const TIME_CATEGORY_LABELS: Record<TimeActivityCategory, string> = {
  LEGAL_RESEARCH: "Legal research",
  DISCOVERY_REVIEW: "Discovery review",
  DOCUMENT_REVIEW: "Document review",
  DRAFTING: "Drafting",
  COURT_PREPARATION: "Court preparation",
  COURT_APPEARANCE: "Court appearance",
  TRIAL_WORK: "Trial work",
  CLIENT_COMMUNICATION: "Client communication",
  CONSULTATION: "Consultation",
  WITNESS_INTERVIEW: "Witness interview",
  INVESTIGATION: "Investigation",
  INTERNAL_DISCUSSION: "Internal case discussion",
  ADMINISTRATIVE: "Administrative work",
  OTHER: "Other",
};

export const TIME_CATEGORY_VALUES = Object.keys(TIME_CATEGORY_LABELS) as [TimeActivityCategory, ...TimeActivityCategory[]];

export function timeCategoryLabel(category: TimeActivityCategory): string {
  return TIME_CATEGORY_LABELS[category];
}
