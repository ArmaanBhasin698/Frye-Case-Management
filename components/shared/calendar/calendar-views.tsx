import Link from "next/link";
import { Bell, CheckSquare, Pencil, Repeat, Video } from "lucide-react";

import type { CalendarItem } from "@/lib/calendar/queries";
import { isAllDayLike, itemsByDay, layoutTimedItems } from "@/lib/calendar/layout";
import { occurrenceHref } from "@/lib/calendar/occurrences";
import { formatInZone, formatTimeInZone, parseDateKey } from "@/lib/calendar/timezone";
import { calendarEventTypeLabel, deadlineTypeLabel } from "@/lib/matters/format";
import { cn } from "@/lib/utils";

/**
 * Server-rendered month / week / day / agenda views. Every item shown here
 * came from lib/calendar/queries.ts#getCalendarItems, already scoped to
 * what the viewer may see. Links carry the view state in the URL.
 */

const HOUR_HEIGHT = 44;

function itemHref(item: CalendarItem) {
  if (item.kind === "event") return occurrenceHref(item.id, item.originalStart);
  if (item.kind === "task") return `/matters/${item.matter?.id}/tasks`;
  return `/matters/${item.matter?.id}/deadlines`;
}

function itemTone(item: CalendarItem) {
  if (item.kind === "deadline") return "border-amber-300 bg-amber-50 text-amber-900";
  if (item.kind === "task") {
    return item.taskStatus === "DONE"
      ? "border-border bg-muted text-muted-foreground line-through"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (item.status === "CANCELLED") return "border-border bg-muted text-muted-foreground line-through";
  if (item.eventType === "HEARING" || item.eventType === "TRIAL") return "border-primary/40 bg-primary/10 text-foreground";
  return "border-sky-200 bg-sky-50 text-sky-950";
}

function itemLabel(item: CalendarItem) {
  if (item.kind === "deadline" && item.deadlineType) return `${deadlineTypeLabel(item.deadlineType)}: ${item.title}`;
  if (item.kind === "task") return `Task due: ${item.title}`;
  return item.title;
}

function Icons({ item }: { item: CalendarItem }) {
  return (
    <>
      {item.kind === "task" && <CheckSquare className="mr-1 inline h-3 w-3" aria-label="Task" />}
      {item.meetingUrl && <Video className="mr-1 inline h-3 w-3" aria-label="Has meeting link" />}
      {item.recurring && <Repeat className="mr-1 inline h-3 w-3" aria-label="Repeats" />}
      {item.modified && <Pencil className="mr-1 inline h-3 w-3" aria-label="This occurrence was changed" />}
      {item.reminderOffsetsMinutes.length > 0 && <Bell className="mr-1 inline h-3 w-3" aria-label="Reminder set" />}
    </>
  );
}

function Chip({ item, timeZone }: { item: CalendarItem; timeZone: string }) {
  return (
    <Link
      href={itemHref(item)}
      className={cn("block truncate rounded border px-1.5 py-0.5 text-xs hover:opacity-80", itemTone(item))}
      title={itemLabel(item)}
    >
      <Icons item={item} />
      {!item.allDay && <span className="font-medium">{formatTimeInZone(item.start, timeZone)} </span>}
      {itemLabel(item)}
    </Link>
  );
}

export function dayHref(view: string, key: string, base: URLSearchParams) {
  const params = new URLSearchParams(base);
  params.set("view", view);
  params.set("date", key);
  return `/calendar?${params.toString()}`;
}

export function MonthView({
  days,
  anchor,
  today,
  items,
  timeZone,
  baseParams,
}: {
  days: string[];
  anchor: string;
  today: string;
  items: CalendarItem[];
  timeZone: string;
  baseParams: URLSearchParams;
}) {
  const byDay = itemsByDay(items, days, timeZone);
  const month = anchor.slice(0, 7);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((key) => {
          const dayItems = byDay.get(key) ?? [];
          const inMonth = key.startsWith(month);
          return (
            <div
              key={key}
              className={cn(
                "min-h-28 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-muted/30",
                key === anchor && "ring-1 ring-inset ring-primary/40",
              )}
            >
              <Link
                href={dayHref("day", key, baseParams)}
                className={cn(
                  "mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium hover:bg-muted",
                  !inMonth && "text-muted-foreground",
                  key === today && "bg-primary text-primary-foreground hover:bg-primary",
                )}
                aria-label={`View ${key}`}
                aria-current={key === today ? "date" : undefined}
              >
                {parseDateKey(key)!.day}
              </Link>
              <div className="space-y-0.5">
                {dayItems.slice(0, 4).map((item) => (
                  <Chip key={item.key} item={item} timeZone={timeZone} />
                ))}
                {dayItems.length > 4 && (
                  <Link href={dayHref("day", key, baseParams)} className="block px-1 text-xs text-muted-foreground hover:underline">
                    +{dayItems.length - 4} more
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimeGridView({
  days,
  today,
  items,
  timeZone,
  baseParams,
}: {
  days: string[];
  today: string;
  items: CalendarItem[];
  timeZone: string;
  baseParams: URLSearchParams;
}) {
  const byDay = itemsByDay(items, days, timeZone);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid border-b border-border bg-muted/40" style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((key) => {
          const d = parseDateKey(key)!;
          const label = formatInZone(new Date(Date.UTC(d.year, d.month - 1, d.day, 12)), "UTC", { weekday: "short", month: "short", day: "numeric" });
          return (
            <Link
              key={key}
              href={dayHref("day", key, baseParams)}
              className={cn("py-2 text-center text-xs font-semibold hover:underline", key === today && "text-primary")}
              aria-current={key === today ? "date" : undefined}
            >
              {label}
            </Link>
          );
        })}
      </div>
      <div className="grid border-b border-border" style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="px-1 py-1 text-right text-[10px] uppercase text-muted-foreground">All day</div>
        {days.map((key) => (
          <div key={key} className="min-h-8 space-y-0.5 border-l border-border p-1">
            {(byDay.get(key) ?? [])
              .filter((item) => isAllDayLike(item, timeZone))
              .map((item) => (
                <Chip key={item.key} item={item} timeZone={timeZone} />
              ))}
          </div>
        ))}
      </div>
      <div className="max-h-[36rem] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div>
            {hours.map((h) => (
              <div key={h} className="pr-1 text-right text-[10px] text-muted-foreground" style={{ height: HOUR_HEIGHT }}>
                {h === 0 ? "" : formatInZone(new Date(Date.UTC(2026, 0, 1, h)), "UTC", { hour: "numeric" })}
              </div>
            ))}
          </div>
          {days.map((key) => {
            const placed = layoutTimedItems(
              (byDay.get(key) ?? []).filter((item) => !isAllDayLike(item, timeZone)),
              key,
              timeZone,
            );
            return (
              <div key={key} className={cn("relative border-l border-border", key === today && "bg-primary/[0.03]")}>
                {hours.map((h) => (
                  <div key={h} className="border-b border-border/60" style={{ height: HOUR_HEIGHT }} />
                ))}
                {placed.map(({ item, topMinutes, durationMinutes, lane, lanes }) => (
                  <Link
                    key={item.key}
                    href={itemHref(item)}
                    className={cn("absolute overflow-hidden rounded border px-1 py-0.5 text-xs hover:z-10 hover:opacity-90", itemTone(item))}
                    style={{
                      top: (topMinutes / 60) * HOUR_HEIGHT,
                      height: Math.max((durationMinutes / 60) * HOUR_HEIGHT - 2, 18),
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                    }}
                    title={itemLabel(item)}
                  >
                    <span className="font-medium">
                      <Icons item={item} />
                      {formatTimeInZone(item.start, timeZone)}
                    </span>{" "}
                    {itemLabel(item)}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AgendaView({ days, items, timeZone, today }: { days: string[]; items: CalendarItem[]; timeZone: string; today: string }) {
  const byDay = itemsByDay(items, days, timeZone);
  const withItems = days.filter((key) => (byDay.get(key) ?? []).length > 0);
  if (withItems.length === 0) {
    return <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">Nothing scheduled in this period.</p>;
  }
  return (
    <div className="space-y-4">
      {withItems.map((key) => {
        const d = parseDateKey(key)!;
        return (
          <section key={key} className="rounded-lg border border-border bg-card">
            <h3 className={cn("border-b border-border px-4 py-2 text-sm font-semibold", key === today && "text-primary")}>
              {formatInZone(new Date(Date.UTC(d.year, d.month - 1, d.day, 12)), "UTC", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              {key === today && " · Today"}
            </h3>
            <ul className="divide-y divide-border">
              {(byDay.get(key) ?? []).map((item) => (
                <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link href={itemHref(item)} className={cn("text-sm font-medium hover:underline", item.status === "CANCELLED" && "line-through text-muted-foreground")}>
                      <Icons item={item} />
                      {itemLabel(item)}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {item.allDay
                        ? "All day"
                        : `${formatTimeInZone(item.start, timeZone)}${item.end ? ` – ${formatTimeInZone(item.end, timeZone)}` : ""}`}
                      {item.kind === "event" && item.eventType ? ` · ${calendarEventTypeLabel(item.eventType)}` : ""}
                      {item.kind === "task" ? " · Task (read-only)" : ""}
                      {item.matter ? ` · ${item.matter.caseNumber}` : " · Internal"}
                      {item.location ? ` · ${item.location}` : ""}
                    </p>
                  </div>
                  {item.meetingUrl && item.status !== "CANCELLED" && (
                    <a
                      href={item.meetingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                    >
                      <Video className="mr-1 h-3 w-3" />
                      Join
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
