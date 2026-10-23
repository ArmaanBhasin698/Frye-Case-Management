import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { hasMatterAccess } from "@/lib/auth/access";
import { floorToMinute } from "@/lib/usage/estimate";
import { USAGE_MODULES } from "@/lib/usage/sanitize";
import { touchUserSession } from "@/lib/usage/sessions";

/**
 * Activity heartbeat (components/shared/activity-heartbeat.tsx). Records
 * that the signed-in user was active during the current minute — nothing
 * else: no keystrokes, pointer data, page content, or URL query strings.
 *
 * - Session required (proxy.ts already redirects anonymous requests; this
 *   re-checks and answers 401 regardless).
 * - Same-origin only, so another site can't inflate someone's activity.
 * - One row per (user, minute) via the unique key: repeated beats from
 *   several tabs/devices in the same minute are an idempotent upsert,
 *   which is both the rate limit and the double-counting guard.
 * - A matterId is stored only if the user can access that matter.
 */

const bodySchema = z.object({
  module: z.enum([...USAGE_MODULES, "other"]),
  matterId: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/).optional(),
});

function isSameOrigin(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return fetchSite === "same-origin";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const matterId =
    parsed.data.matterId && (await hasMatterAccess(user, parsed.data.matterId)) ? parsed.data.matterId : null;
  const minute = floorToMinute(new Date());

  try {
    await prisma.userActivityMinute.upsert({
      where: { userId_minute: { userId: user.id, minute } },
      create: { userId: user.id, minute, sessionId: user.sessionId ?? null, module: parsed.data.module, matterId },
      update: { module: parsed.data.module, matterId, ...(user.sessionId ? { sessionId: user.sessionId } : {}) },
    });
  } catch {
    // A forged/stale matter id that passed the access check for an admin
    // (admins pass for any id) can still fail the FK — store no matter.
    await prisma.userActivityMinute
      .upsert({
        where: { userId_minute: { userId: user.id, minute } },
        create: { userId: user.id, minute, sessionId: user.sessionId ?? null, module: parsed.data.module },
        update: { module: parsed.data.module, matterId: null },
      })
      .catch(() => undefined);
  }
  await touchUserSession(user.sessionId, user.id);

  return NextResponse.json({ ok: true });
}
