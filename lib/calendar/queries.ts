import type { CalendarEventType, DeadlineType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { matterScopeFilterFor } from "@/lib/auth/access";
import type { AuthorizableUser } from "@/lib/auth/authorization";
import { asCalendarDate } from "@/lib/matters/format";

/**
 * Firm-wide Calendar aggregate query (see CLAUDE.md, section 4.4 and
 * docs/SECURITY.md). Merges the existing per-matter `Deadline` and
 * `CalendarEvent` models (lib/matters/queries.ts#getMatterDeadlines /
 * getMatterCalendarEvents read the same rows) across every matter `user`
 * may see — no new calendar entity, no duplicated data.
 *
 * Uses the same `matterScopeFilterFor` helper (lib/auth/access.ts)
 * lib/dashboard/queries.ts#getUpcomingKeyDates already relies on for its
 * Dashboard widget: admins get `{}` (no restriction), everyone else gets
 * `{ matterId: { in: assignedMatterIds } }`. Every filter is combined with
 * that scope via `AND` on each underlying query — there is no unscoped
 * "every deadline/event" path.
 */

export type FirmCalendarFilters = {
  matterId?: string;
  kind?: "deadline" | "event";
  /** Only Deadlines have a satisfied/open lifecycle (see docs/DATA_MODEL.md) — ignored for events. */
  deadlineStatus?: "open" | "satisfied";
  /** Default false: only today/future items, the "upcoming schedule" the UI leads with. */
  includePast?: boolean;
};

export type FirmCalendarItem =
  | {
      kind: "deadline";
      id: string;
      date: Date;
      title: string;
      deadlineType: DeadlineType;
      satisfied: boolean;
      matter: { id: string; caseNumber: string; client: { firstName: string; lastName: string } };
    }
  | {
      kind: "event";
      id: string;
      date: Date;
      title: string;
      eventType: CalendarEventType;
      location: string | null;
      matter: { id: string; caseNumber: string; client: { firstName: string; lastName: string } };
    };

export async function getFirmWideCalendarItems(
  user: AuthorizableUser,
  filters: FirmCalendarFilters = {},
): Promise<FirmCalendarItem[]> {
  const scopeWhere = await matterScopeFilterFor(user);
  const now = new Date();

  const includeDeadlines = filters.kind !== "event";
  const includeEvents = filters.kind !== "deadline";

  const deadlineConditions: Prisma.DeadlineWhereInput[] = [scopeWhere];
  if (filters.matterId) deadlineConditions.push({ matterId: filters.matterId });
  if (!filters.includePast) deadlineConditions.push({ date: { gte: now } });
  if (filters.deadlineStatus) deadlineConditions.push({ satisfied: filters.deadlineStatus === "satisfied" });

  const eventConditions: Prisma.CalendarEventWhereInput[] = [scopeWhere];
  if (filters.matterId) eventConditions.push({ matterId: filters.matterId });
  if (!filters.includePast) eventConditions.push({ startTime: { gte: now } });

  const [deadlines, events] = await Promise.all([
    includeDeadlines
      ? prisma.deadline.findMany({
          where: deadlineConditions.length === 1 ? deadlineConditions[0] : { AND: deadlineConditions },
          include: { matter: { include: { client: true } } },
          orderBy: { date: "asc" },
        })
      : Promise.resolve([]),
    includeEvents
      ? prisma.calendarEvent.findMany({
          where: eventConditions.length === 1 ? eventConditions[0] : { AND: eventConditions },
          include: { matter: { include: { client: true } } },
          orderBy: { startTime: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const merged: FirmCalendarItem[] = [
    ...deadlines.map((d) => ({
      kind: "deadline" as const,
      id: d.id,
      date: asCalendarDate(d.date),
      title: d.description,
      deadlineType: d.type,
      satisfied: d.satisfied,
      matter: d.matter,
    })),
    ...events.map((e) => ({
      kind: "event" as const,
      id: e.id,
      date: e.startTime,
      title: e.title,
      eventType: e.type,
      location: e.location,
      matter: e.matter,
    })),
  ];

  merged.sort((a, b) => a.date.getTime() - b.date.getTime());
  return merged;
}
