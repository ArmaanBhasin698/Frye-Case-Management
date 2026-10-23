import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedBearerToken } from "@/lib/intake/webhookAuth";
import { readNotificationsCronSecret } from "@/lib/notifications/config";
import { runNotificationScheduler } from "@/lib/notifications/scheduler";

/**
 * Protected entry point for the eventual deployment scheduler to run the
 * notification scheduler (e.g. every 5 minutes) — GET with
 * `Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>`. Mirrors
 * app/api/cron/highlevel-sync: excluded from proxy.ts's session gate (a
 * scheduler has no session cookie), fails closed when the secret is unset,
 * and returns counts only. The scheduler's own lock makes overlapping
 * calls harmless.
 */
export async function GET(request: NextRequest) {
  let secret: string;
  try {
    secret = readNotificationsCronSecret();
  } catch (error) {
    console.error("[cron/notifications] cron secret not configured", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  if (!isAuthorizedBearerToken(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runNotificationScheduler();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[cron/notifications] run failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
