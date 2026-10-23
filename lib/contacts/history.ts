import type {
  CallDirection,
  ContactCategory,
  ContactInteractionType,
  FollowUpStatus,
  MatterStatus,
} from "@prisma/client";

/**
 * Pure assembly for a contact's Associated Matters list and interaction
 * timeline. Inputs must already be restricted to matters the viewer can
 * access (lib/contacts/queries.ts does that) — nothing here filters for
 * authorization, so nothing here can be the thing that leaks.
 */

export type ClientStatus = "CURRENT" | "FORMER" | "NO_MATTERS";

/**
 * Current vs. former client, derived — never stored. "Current" means at
 * least one OPEN/PENDING matter among `matters`. Callers pass only the
 * matters the viewer can see, so the badge never hints at a matter the
 * viewer isn't on.
 */
export function deriveClientStatus(matters: { status: MatterStatus }[]): ClientStatus {
  if (matters.length === 0) return "NO_MATTERS";
  return matters.some((m) => m.status !== "CLOSED") ? "CURRENT" : "FORMER";
}

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  CURRENT: "Current client",
  FORMER: "Former client",
  NO_MATTERS: "Client (no visible matters)",
};

type MatterSummary = {
  id: string;
  caseNumber: string;
  status: MatterStatus;
  archived: boolean;
  openedDate: Date;
  closedDate: Date | null;
  client: { firstName: string; lastName: string };
  assignments: { role: string; user: { name: string } }[];
};

export type AssociatedMatterRow = {
  matter: MatterSummary;
  role: ContactCategory | "CLIENT";
  roleDetail: string | null;
  startDate: Date | null;
  endDate: Date | null;
  leadAttorney: string | null;
  lastInteractionAt: Date | null;
};

export function buildAssociatedMatters(input: {
  links: {
    role: ContactCategory;
    roleDetail: string | null;
    startDate: Date | null;
    endDate: Date | null;
    matter: MatterSummary;
  }[];
  clientMatters: MatterSummary[];
  lastInteractionByMatter: Map<string, Date>;
}): AssociatedMatterRow[] {
  const leadOf = (m: MatterSummary) => m.assignments.find((a) => a.role === "LEAD_ATTORNEY")?.user.name ?? null;

  const rows: AssociatedMatterRow[] = [
    ...input.clientMatters.map((matter) => ({
      matter,
      role: "CLIENT" as const,
      roleDetail: null,
      startDate: matter.openedDate,
      endDate: matter.closedDate,
      leadAttorney: leadOf(matter),
      lastInteractionAt: input.lastInteractionByMatter.get(matter.id) ?? null,
    })),
    ...input.links.map((link) => ({
      matter: link.matter,
      role: link.role,
      roleDetail: link.roleDetail,
      startDate: link.startDate,
      endDate: link.endDate,
      leadAttorney: leadOf(link.matter),
      lastInteractionAt: input.lastInteractionByMatter.get(link.matter.id) ?? null,
    })),
  ];

  // Active matters first, then most recently opened.
  return rows.sort((a, b) => {
    const activeA = a.matter.status === "CLOSED" ? 1 : 0;
    const activeB = b.matter.status === "CLOSED" ? 1 : 0;
    if (activeA !== activeB) return activeA - activeB;
    return b.matter.openedDate.getTime() - a.matter.openedDate.getTime();
  });
}

export type TimelineEntry = {
  source: "interaction" | "call";
  id: string;
  occurredAt: Date;
  type: ContactInteractionType;
  staffName: string | null;
  matter: { id: string; caseNumber: string } | null;
  summary: string;
  outcome: string | null;
  followUpStatus: FollowUpStatus;
  callDirection?: CallDirection;
  callDurationSeconds?: number;
};

export function buildTimeline(input: {
  interactions: {
    id: string;
    type: ContactInteractionType;
    occurredAt: Date;
    summary: string;
    outcome: string | null;
    followUpStatus: FollowUpStatus;
    staff: { name: string } | null;
    matter: { id: string; caseNumber: string } | null;
  }[];
  calls: {
    id: string;
    direction: CallDirection;
    occurredAt: Date;
    durationSeconds: number;
    notes: string | null;
    filedBy: { name: string } | null;
    matter: { id: string; caseNumber: string } | null;
  }[];
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...input.interactions.map((i) => ({
      source: "interaction" as const,
      id: i.id,
      occurredAt: i.occurredAt,
      type: i.type,
      staffName: i.staff?.name ?? null,
      matter: i.matter,
      summary: i.summary,
      outcome: i.outcome,
      followUpStatus: i.followUpStatus,
    })),
    ...input.calls.map((c) => ({
      source: "call" as const,
      id: c.id,
      occurredAt: c.occurredAt,
      type: "CALL" as const,
      staffName: c.filedBy?.name ?? null,
      matter: c.matter,
      summary: c.notes ?? "Logged call",
      outcome: null,
      followUpStatus: "NONE" as const,
      callDirection: c.direction,
      callDurationSeconds: c.durationSeconds,
    })),
  ];
  return entries.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}
