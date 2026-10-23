import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEventType } from "@prisma/client";

import { requireCurrentUser } from "@/lib/auth/session";
import { getCalendarFormOptions, getCalendarItems } from "@/lib/calendar/queries";
import { CALENDAR_EVENT_TYPE_VALUES } from "@/lib/calendar/fields";
import { CALENDAR_VIEWS, getViewRange, normalizeAnchor, normalizeView } from "@/lib/calendar/range";
import { FIRM_TIME_ZONE, dateKeyInZone, formatInZone, parseDateKey, zoneAbbreviation } from "@/lib/calendar/timezone";
import { calendarEventTypeLabel } from "@/lib/matters/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { AgendaView, MonthView, TimeGridView } from "@/components/shared/calendar/calendar-views";
import { cn } from "@/lib/utils";

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function noonUtc(key: string) {
  const d = parseDateKey(key)!;
  return new Date(Date.UTC(d.year, d.month - 1, d.day, 12));
}

/**
 * Firm calendar: month / week / day / agenda over CalendarEvents (with
 * recurrence expanded) and matter Deadlines. All state lives in the URL
 * (?view=week&date=2026-10-23&matterId=…), and every item comes from
 * lib/calendar/queries.ts#getCalendarItems, which applies the viewer's
 * event/matter visibility server-side. The grid renders in the firm's
 * display zone; each event keeps its own zone for its detail page.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const timeZone = FIRM_TIME_ZONE;
  const now = new Date();
  const today = dateKeyInZone(now, timeZone);

  const view = normalizeView(readParam(params.view));
  const anchor = normalizeAnchor(readParam(params.date), now, timeZone);
  const range = getViewRange(view, anchor, timeZone);

  const options = await getCalendarFormOptions(user);
  const matterId = readParam(params.matterId) ?? "";
  const staffId = readParam(params.staffId) ?? "";
  const typeParam = readParam(params.type) ?? "";
  const type = (CALENDAR_EVENT_TYPE_VALUES as readonly string[]).includes(typeParam) ? (typeParam as CalendarEventType) : undefined;
  const includeCancelled = readParam(params.cancelled) === "1";

  const items = await getCalendarItems(user, {
    start: range.start,
    end: range.end,
    firstDay: range.days[0]!,
    lastDay: range.days[range.days.length - 1]!,
    // Only filter by ids the viewer was offered; anything else is ignored.
    matterId: options.matters.some((m) => m.id === matterId) ? matterId : undefined,
    staffId: options.staff.some((s) => s.id === staffId) ? staffId : undefined,
    type,
    includeCancelled,
  });

  const filterParams = new URLSearchParams();
  if (matterId) filterParams.set("matterId", matterId);
  if (staffId) filterParams.set("staffId", staffId);
  if (type) filterParams.set("type", type);
  if (includeCancelled) filterParams.set("cancelled", "1");
  const href = (nextView: string, date: string) => {
    const p = new URLSearchParams(filterParams);
    p.set("view", nextView);
    p.set("date", date);
    return `/calendar?${p.toString()}`;
  };

  const first = range.days[0]!;
  const last = range.days[range.days.length - 1]!;
  const title =
    view === "month"
      ? formatInZone(noonUtc(anchor), "UTC", { month: "long", year: "numeric" })
      : view === "day"
        ? formatInZone(noonUtc(anchor), "UTC", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
        : `${formatInZone(noonUtc(first), "UTC", { month: "short", day: "numeric" })} – ${formatInZone(noonUtc(last), "UTC", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Events, hearings, meetings, and matter deadlines you have access to · times in {zoneAbbreviation(now, timeZone)} (
            {timeZone.replace("_", " ")})
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href={`/calendar/events/new?date=${anchor}${matterId ? `&matterId=${matterId}` : ""}`}>New event</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={href(view, today)}>Today</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild aria-label="Previous">
            <Link href={href(view, range.prev)}>
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild aria-label="Next">
            <Link href={href(view, range.next)}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        </div>
        <nav className="flex rounded-md border border-border p-0.5" aria-label="Calendar view">
          {CALENDAR_VIEWS.map((v) => (
            <Link
              key={v}
              href={href(v, anchor)}
              className={cn(
                "rounded px-3 py-1 text-sm capitalize",
                v === view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={v === view ? "page" : undefined}
            >
              {v}
            </Link>
          ))}
        </nav>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="date" value={anchor} />
        <div className="space-y-1">
          <Label htmlFor="cal-matter" className="text-xs">
            Matter
          </Label>
          <Select id="cal-matter" name="matterId" className="w-56" defaultValue={matterId}>
            <option value="">All matters</option>
            {options.matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cal-staff" className="text-xs">
            Staff
          </Label>
          <Select id="cal-staff" name="staffId" className="w-44" defaultValue={staffId}>
            <option value="">Anyone</option>
            {options.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cal-type" className="text-xs">
            Type
          </Label>
          <Select id="cal-type" name="type" className="w-44" defaultValue={type ?? ""}>
            <option value="">All types + deadlines</option>
            {CALENDAR_EVENT_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {calendarEventTypeLabel(t)}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="cancelled" value="1" defaultChecked={includeCancelled} />
          Show cancelled
        </label>
        <Button type="submit" size="sm">
          Apply
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/calendar?view=${view}&date=${anchor}`}>Clear</Link>
        </Button>
      </form>

      {view === "month" && (
        <MonthView days={range.days} anchor={anchor} today={today} items={items} timeZone={timeZone} baseParams={filterParams} />
      )}
      {(view === "week" || view === "day") && (
        <TimeGridView days={range.days} today={today} items={items} timeZone={timeZone} baseParams={filterParams} />
      )}
      {view === "agenda" && <AgendaView days={range.days} items={items} timeZone={timeZone} today={today} />}
    </div>
  );
}
