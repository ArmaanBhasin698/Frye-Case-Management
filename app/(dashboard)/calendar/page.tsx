import Link from "next/link";
import { format } from "date-fns";

import {
  getFirmWideCalendarItems,
  type FirmCalendarFilters,
  type FirmCalendarItem,
} from "@/lib/calendar/queries";
import { listMatters } from "@/lib/matters/queries";
import { calendarEventTypeLabel, deadlineTypeLabel, formatClientName, matterTitle } from "@/lib/matters/format";
import { requireCurrentUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarFilterBar, type CalendarFilterValues } from "@/components/shared/calendar-filter-bar";

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function groupByDay(items: FirmCalendarItem[]) {
  const groups = new Map<string, { key: string; label: string; items: FirmCalendarItem[] }>();
  for (const item of items) {
    const key = format(item.date, "yyyy-MM-dd");
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, { key, label: format(item.date, "EEEE, MMM d, yyyy"), items: [item] });
    }
  }
  return [...groups.values()];
}

/**
 * Firm-wide Calendar (app/(dashboard)/calendar) — an authorized aggregate
 * view over the existing per-matter `Deadline` and `CalendarEvent`
 * models, not a new calendar entity. `getFirmWideCalendarItems`
 * (lib/calendar/queries.ts) scopes both underlying queries server-side to
 * matters `user` may see; every filter below is read from the URL,
 * validated against a fixed allowlist, and passed straight through to
 * that helper. Time-of-day handling is unchanged from the per-matter
 * Deadlines & Calendar tab — CalendarEvent's `datetime-local` inputs have
 * no timezone field and are interpreted as the server's local time (see
 * README's "known limitations").
 */
export default async function FirmCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;

  const matterId = readParam(params.matterId) || "";
  const kindParam = readParam(params.kind);
  const deadlineStatusParam = readParam(params.deadlineStatus);
  const includePast = readParam(params.includePast) === "1";

  const kind = kindParam === "deadline" || kindParam === "event" ? kindParam : undefined;
  const deadlineStatus =
    deadlineStatusParam === "open" || deadlineStatusParam === "satisfied" ? deadlineStatusParam : undefined;

  const filters: FirmCalendarFilters = {
    matterId: matterId || undefined,
    kind,
    deadlineStatus,
    includePast,
  };

  const [items, matters] = await Promise.all([getFirmWideCalendarItems(user, filters), listMatters(user)]);

  const currentFilters: CalendarFilterValues = {
    matterId,
    kind: kind ?? "",
    deadlineStatus: deadlineStatus ?? "",
    includePast: includePast ? "1" : "",
  };

  const matterOptions = matters.map((m) => ({ id: m.id, label: `${matterTitle(m)} · ${m.caseNumber}` }));
  const groups = groupByDay(items);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Firm-wide deadlines and calendar events across every matter you have access to — an aggregate
          view over each matter&apos;s own Deadlines &amp; Calendar tab, not a separate record.
        </p>
      </div>

      <CalendarFilterBar basePath="/calendar" current={currentFilters} matters={matterOptions} />

      <Card>
        <CardContent className="p-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
          ) : (
            <div className="space-y-6">
              {groups.map((group) => (
                <div key={group.key} className="space-y-2">
                  <h2 className="text-sm font-semibold text-foreground">{group.label}</h2>
                  <ul className="divide-y divide-border">
                    {group.items.map((item) => (
                      <li
                        key={`${item.kind}-${item.id}`}
                        className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/matters/${item.matter.id}/deadlines`}
                              className="text-sm font-medium text-foreground hover:underline"
                            >
                              {item.title}
                            </Link>
                            <Badge variant={item.kind === "deadline" ? "warning" : "outline"}>
                              {item.kind === "deadline"
                                ? deadlineTypeLabel(item.deadlineType)
                                : calendarEventTypeLabel(item.eventType)}
                            </Badge>
                            {item.kind === "deadline" && (
                              <Badge variant={item.satisfied ? "success" : "outline"}>
                                {item.satisfied ? "Satisfied" : "Open"}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            <Link href={`/matters/${item.matter.id}`} className="hover:underline">
                              {matterTitle(item.matter)}
                            </Link>{" "}
                            &middot; {formatClientName(item.matter.client)}
                            {item.kind === "event" && item.location ? ` · ${item.location}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          {item.kind === "event" ? format(item.date, "h:mm a") : "All day"}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
