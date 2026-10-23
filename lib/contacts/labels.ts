import type {
  ContactCategory,
  ContactInteractionType,
  ContactRelationshipType,
  FollowUpStatus,
  PreferredContactMethod,
} from "@prisma/client";

/** Display labels for the Contacts module — pure, shared by pages, forms, and tests. */

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  PROSPECTIVE_CLIENT: "Prospective client",
  JUDGE: "Judge",
  PROSECUTOR: "Prosecutor",
  ASSISTANT_DISTRICT_ATTORNEY: "Assistant District Attorney",
  SOLICITOR: "Solicitor",
  DEFENSE_ATTORNEY: "Defense attorney",
  OPPOSING_COUNSEL: "Opposing counsel",
  POLICE_OFFICER: "Police officer",
  DETECTIVE: "Detective",
  SHERIFF_DEPUTY: "Sheriff / Deputy",
  LAW_ENFORCEMENT_AGENCY: "Law enforcement agency",
  COURT_CLERK: "Court clerk",
  COURT_ADMINISTRATOR: "Court administrator",
  PROBATION_OFFICER: "Probation officer",
  INVESTIGATOR: "Investigator",
  EXPERT_WITNESS: "Expert witness",
  WITNESS: "Witness",
  CO_DEFENDANT: "Co-defendant",
  FAMILY_MEMBER: "Family member",
  EMERGENCY_CONTACT: "Emergency contact",
  INTERPRETER: "Interpreter",
  BAIL_BONDSMAN: "Bail bondsman",
  CORRECTIONAL_FACILITY_CONTACT: "Correctional facility contact",
  VENDOR: "Vendor",
  OTHER_PROFESSIONAL: "Other professional contact",
};

export const CONTACT_CATEGORY_VALUES = Object.keys(CONTACT_CATEGORY_LABELS) as [
  ContactCategory,
  ...ContactCategory[],
];

/** Grouping used by the category checkboxes and filter dropdown. */
export const CONTACT_CATEGORY_GROUPS: { label: string; categories: ContactCategory[] }[] = [
  {
    label: "Court & prosecution",
    categories: [
      "JUDGE",
      "PROSECUTOR",
      "ASSISTANT_DISTRICT_ATTORNEY",
      "SOLICITOR",
      "COURT_CLERK",
      "COURT_ADMINISTRATOR",
      "PROBATION_OFFICER",
      "INTERPRETER",
    ],
  },
  {
    label: "Law enforcement",
    categories: ["POLICE_OFFICER", "DETECTIVE", "SHERIFF_DEPUTY", "LAW_ENFORCEMENT_AGENCY", "CORRECTIONAL_FACILITY_CONTACT"],
  },
  {
    label: "Counsel & experts",
    categories: ["DEFENSE_ATTORNEY", "OPPOSING_COUNSEL", "INVESTIGATOR", "EXPERT_WITNESS"],
  },
  {
    label: "People in the case",
    categories: ["PROSPECTIVE_CLIENT", "WITNESS", "CO_DEFENDANT", "FAMILY_MEMBER", "EMERGENCY_CONTACT"],
  },
  { label: "Other", categories: ["BAIL_BONDSMAN", "VENDOR", "OTHER_PROFESSIONAL"] },
];

/** Categories whose profile shows court / jurisdiction / position fields. */
export const PROFESSIONAL_COURT_CATEGORIES: ReadonlySet<ContactCategory> = new Set([
  "JUDGE",
  "PROSECUTOR",
  "ASSISTANT_DISTRICT_ATTORNEY",
  "SOLICITOR",
  "COURT_CLERK",
  "COURT_ADMINISTRATOR",
  "PROBATION_OFFICER",
]);

export const PREFERRED_CONTACT_METHOD_LABELS: Record<PreferredContactMethod, string> = {
  PHONE: "Phone",
  TEXT: "Text message",
  EMAIL: "Email",
  MAIL: "Mail",
  IN_PERSON: "In person",
};

export const PREFERRED_CONTACT_METHOD_VALUES = Object.keys(PREFERRED_CONTACT_METHOD_LABELS) as [
  PreferredContactMethod,
  ...PreferredContactMethod[],
];

export const RELATIONSHIP_TYPE_LABELS: Record<ContactRelationshipType, string> = {
  PARENT: "Parent",
  CHILD: "Child",
  SPOUSE: "Spouse",
  SIBLING: "Sibling",
  FAMILY_MEMBER: "Family member",
  EMPLOYER: "Employer",
  EMPLOYEE: "Employee",
  WITNESS: "Witness",
  CO_DEFENDANT: "Co-defendant",
  ARRESTING_OFFICER: "Arresting officer",
  INVESTIGATING_DETECTIVE: "Investigating detective",
  ASSIGNED_PROSECUTOR: "Prosecutor assigned to case",
  ASSIGNED_JUDGE: "Judge assigned to case",
  EXPERT_WITNESS: "Expert witness",
  DEFENSE_INVESTIGATOR: "Defense investigator",
  OTHER: "Other associated person",
};

export const RELATIONSHIP_TYPE_VALUES = Object.keys(RELATIONSHIP_TYPE_LABELS) as [
  ContactRelationshipType,
  ...ContactRelationshipType[],
];

/**
 * A relationship is stored once, directionally: "from is <type> of to"
 * (Pat Doe is PARENT of Jane Doe). On `to`'s profile the other contact is
 * simply labelled with the type ("Parent"). On `from`'s profile the label
 * has to be inverted: a true inverse where one exists ("Child"), the same
 * word for symmetric types ("Spouse"), and otherwise an explicit sentence
 * so the direction can't be misread ("This contact is their arresting
 * officer").
 */
const INVERSE_RELATIONSHIP_LABELS: Partial<Record<ContactRelationshipType, string>> = {
  PARENT: "Child",
  CHILD: "Parent",
  EMPLOYER: "Employee",
  EMPLOYEE: "Employer",
  SPOUSE: "Spouse",
  SIBLING: "Sibling",
  FAMILY_MEMBER: "Family member",
  CO_DEFENDANT: "Co-defendant",
};

export function relationshipLabelFor(
  relationship: { type: ContactRelationshipType; fromContactId: string },
  viewingContactId: string,
): string {
  const label = RELATIONSHIP_TYPE_LABELS[relationship.type];
  if (relationship.fromContactId !== viewingContactId) return label;
  return INVERSE_RELATIONSHIP_LABELS[relationship.type] ?? `This contact is their ${label.toLowerCase()}`;
}

export const INTERACTION_TYPE_LABELS: Record<ContactInteractionType, string> = {
  CALL: "Call",
  MEETING: "Meeting",
  EMAIL: "Email",
  NOTE: "Note",
  COURT_APPEARANCE: "Court appearance",
  CONSULTATION: "Consultation",
  FOLLOW_UP: "Follow-up",
};

export const INTERACTION_TYPE_VALUES = Object.keys(INTERACTION_TYPE_LABELS) as [
  ContactInteractionType,
  ...ContactInteractionType[],
];

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  NONE: "No follow-up",
  PENDING: "Follow-up pending",
  COMPLETED: "Follow-up completed",
};

export const FOLLOW_UP_STATUS_VALUES = Object.keys(FOLLOW_UP_STATUS_LABELS) as [FollowUpStatus, ...FollowUpStatus[]];
