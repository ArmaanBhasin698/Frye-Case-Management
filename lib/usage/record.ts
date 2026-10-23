import type { ActivityEventType, ActivityResult } from "@prisma/client";

import { prisma } from "@/lib/db";
import { moduleForPath, sanitizePath } from "@/lib/usage/sanitize";

/**
 * Append one usage-analytics event (UserActivityEvent). The input is
 * deliberately narrow — identifiers, an enum type, a module label, and a
 * path that is sanitized here (query strings stripped, ids collapsed) — so
 * there is no field that could carry message bodies, note text, document
 * contents, passwords, or tokens. Identifier fields that don't look like an
 * identifier are dropped rather than stored.
 *
 * Never throws: analytics must never break the request it observes.
 *
 * Use `await recordActivity(...)` from Route Handlers / Server Actions, or
 * `after(() => recordActivity(...))` from Server Components. Example for a
 * report export:
 *
 *   await recordActivity({ userId: user.id, sessionId: user.sessionId,
 *     type: "REPORT_EXPORT", module: "reports", path: request.nextUrl.pathname,
 *     resourceType: "MatterTimeReport", resourceId: matterId, matterId });
 */
export type RecordActivityInput = {
  userId: string | null;
  sessionId?: string | null;
  type: ActivityEventType;
  module?: string | null;
  path?: string | null;
  matterId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  result?: ActivityResult;
};

const SAFE_TOKEN = /^[A-Za-z0-9_\-.:]{1,100}$/;

function safeToken(value: string | null | undefined): string | null {
  return value && SAFE_TOKEN.test(value) ? value : null;
}

export function buildActivityData(input: RecordActivityInput) {
  const path = sanitizePath(input.path);
  return {
    userId: safeToken(input.userId),
    sessionId: safeToken(input.sessionId),
    type: input.type,
    module: safeToken(input.module) ?? (path ? moduleForPath(path) : null),
    path,
    matterId: safeToken(input.matterId),
    resourceType: safeToken(input.resourceType),
    resourceId: safeToken(input.resourceId),
    result: input.result ?? "SUCCESS",
  };
}

export async function recordActivity(input: RecordActivityInput): Promise<boolean> {
  try {
    await prisma.userActivityEvent.create({ data: buildActivityData(input) });
    return true;
  } catch {
    return false;
  }
}
