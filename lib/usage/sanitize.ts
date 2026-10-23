/**
 * Pure helpers that reduce a request path to something safe to store in
 * usage analytics: no query string or fragment (search terms, filters,
 * and callback URLs can carry names), opaque record ids collapsed to
 * ":id", and a short module label. Nothing here ever sees request bodies.
 */

const MAX_PATH_LENGTH = 200;

/** cuid/uuid-like, numeric, or long opaque segments — never meaningful to analytics, sometimes identifying. */
function isIdSegment(segment: string): boolean {
  return (
    /^c[a-z0-9]{20,}$/i.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^\d+$/.test(segment) ||
    segment.length > 40
  );
}

export function sanitizePath(rawPath: string | null | undefined): string | null {
  if (!rawPath) return null;
  let path: string;
  try {
    // Accepts absolute URLs too, but keeps only the pathname.
    path = new URL(rawPath, "http://placeholder.invalid").pathname;
  } catch {
    return null;
  }
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // keep the raw segment
      }
      return isIdSegment(decoded) ? ":id" : decoded.replace(/[^a-zA-Z0-9_\-.:[\]]/g, "");
    });
  return `/${segments.join("/")}`.slice(0, MAX_PATH_LENGTH);
}

export const USAGE_MODULES = [
  "dashboard",
  "matters",
  "clients",
  "contacts",
  "intake",
  "tasks",
  "calendar",
  "discovery",
  "communications",
  "reports",
  "chat",
  "time",
  "admin",
  "account",
] as const;

export type UsageModule = (typeof USAGE_MODULES)[number] | "other";

/** First path segment mapped to a known module; anything else is "other". */
export function moduleForPath(rawPath: string | null | undefined): UsageModule {
  const path = sanitizePath(rawPath);
  if (!path || path === "/") return "dashboard";
  const first = path.split("/")[1] ?? "";
  return (USAGE_MODULES as readonly string[]).includes(first) ? (first as UsageModule) : "other";
}

/** The matter id in a /matters/<id>/... path, if any. */
export function matterIdFromPath(rawPath: string | null | undefined): string | null {
  if (!rawPath) return null;
  const match = /^\/matters\/([^/?#]+)/.exec(rawPath);
  if (!match || match[1] === "new") return null;
  return match[1] ?? null;
}
