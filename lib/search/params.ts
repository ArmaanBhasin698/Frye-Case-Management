import { z } from "zod";

/**
 * Global-search input parsing and presentation helpers — pure, so the
 * bounds and matching rules are unit-testable.
 *
 * Matching rule (documented on the search page): case-insensitive
 * *partial* (substring) matching on each type's listed fields. On the
 * first page of a type, records whose primary field equals the query
 * exactly (case-insensitive) are listed before the other matches.
 */

export const SEARCH_TYPES = [
  "matters",
  "clients",
  "contacts",
  "tasks",
  "documents",
  "time",
  "notes",
  "chat",
  "rulings",
  "observations",
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  matters: "Matters",
  clients: "Clients",
  contacts: "Contacts",
  tasks: "Tasks",
  documents: "Documents (metadata)",
  time: "Time entries",
  notes: "Notes",
  chat: "Chat messages",
  rulings: "Judicial rulings",
  observations: "Professional observations",
};

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_PAGE_SIZE = 25;
/** Per-type preview size when no single type is selected. */
export const SEARCH_PREVIEW_SIZE = 5;

export type ArchivedFilter = "active" | "archived" | "all";

export type SearchParams = {
  q: string;
  type?: SearchType;
  from?: Date;
  /** Exclusive upper bound (start of the day after `to`). */
  to?: Date;
  fromDay?: string;
  toDay?: string;
  matterId?: string;
  archived: ArchivedFilter;
  page: number;
};

export type ParsedSearch = { ok: true; params: SearchParams } | { ok: false; reason: "empty" | "too_short" | "too_long" };

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idToken = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

function first(v: string | string[] | undefined): string | undefined {
  return (Array.isArray(v) ? v[0] : v) || undefined;
}

export function parseSearchParams(raw: Record<string, string | string[] | undefined>): ParsedSearch {
  const q = (first(raw.q) ?? "").trim().replace(/\s+/g, " ");
  if (!q) return { ok: false, reason: "empty" };
  if (q.length < SEARCH_MIN_LENGTH) return { ok: false, reason: "too_short" };
  if (q.length > SEARCH_MAX_LENGTH) return { ok: false, reason: "too_long" };

  const typeRaw = first(raw.type);
  const type = SEARCH_TYPES.includes(typeRaw as SearchType) ? (typeRaw as SearchType) : undefined;
  const fromDay = isoDay.safeParse(first(raw.from)).success ? first(raw.from) : undefined;
  const toDay = isoDay.safeParse(first(raw.to)).success ? first(raw.to) : undefined;
  const from = fromDay ? new Date(`${fromDay}T00:00:00Z`) : undefined;
  const to = toDay ? new Date(new Date(`${toDay}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000) : undefined;
  const matterRaw = first(raw.matterId);
  const archivedRaw = first(raw.archived);
  const archived: ArchivedFilter = archivedRaw === "archived" || archivedRaw === "all" ? archivedRaw : "active";
  const page = Math.min(Math.max(Number.parseInt(first(raw.page) ?? "1", 10) || 1, 1), 1_000);

  return {
    ok: true,
    params: {
      q,
      type,
      from,
      to,
      fromDay,
      toDay,
      matterId: matterRaw && idToken.safeParse(matterRaw).success ? matterRaw : undefined,
      archived,
      page,
    },
  };
}

/**
 * A short excerpt of `text` around the first case-insensitive occurrence
 * of `q`. Only ever called on rows the query already authorized.
 */
export function buildSnippet(text: string | null | undefined, q: string, radius = 60): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat;
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + q.length + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/**
 * Two-segment pagination: exact primary-field matches first, then the
 * remaining partial matches, each in a stable order. Returns the skip/take
 * to apply to each segment for a given page.
 */
export function splitPage(page: number, pageSize: number, exactCount: number) {
  const skip = (page - 1) * pageSize;
  if (skip < exactCount) {
    const exactTake = Math.min(pageSize, exactCount - skip);
    return { exact: { skip, take: exactTake }, rest: { skip: 0, take: pageSize - exactTake } };
  }
  return { exact: { skip: 0, take: 0 }, rest: { skip: skip - exactCount, take: pageSize } };
}

/** Query string for links that keep the current filters. */
export function searchHref(params: Partial<SearchParams> & { q: string }, overrides: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  qs.set("q", params.q);
  if (params.type) qs.set("type", params.type);
  if (params.fromDay) qs.set("from", params.fromDay);
  if (params.toDay) qs.set("to", params.toDay);
  if (params.matterId) qs.set("matterId", params.matterId);
  if (params.archived && params.archived !== "active") qs.set("archived", params.archived);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === "") qs.delete(k);
    else qs.set(k, String(v));
  }
  return `/search?${qs.toString()}`;
}
