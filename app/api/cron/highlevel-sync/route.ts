import { NextRequest, NextResponse } from "next/server";

import { readHighLevelSyncCronSecret } from "@/lib/intake/config";
import { runHighLevelContactSync } from "@/lib/intake/highlevelSync";
import { isAuthorizedBearerToken } from "@/lib/intake/webhookAuth";

/**
 * Protected entry point for whatever deployment scheduler eventually gets
 * chosen (see docs/ARCHITECTURE.md's still-undecided deployment section)
 * to trigger the HighLevel contact sync roughly every 15 minutes — GET
 * `Authorization: Bearer <HIGHLEVEL_SYNC_CRON_SECRET>`. Excluded from
 * proxy.ts's session-auth gate the same way the intake webhook is (a
 * scheduler has no session cookie); this route's own secret check is the
 * only authorization here. Fails closed if the secret isn't configured —
 * never falls back to "unauthenticated allowed."
 *
 * Calls the exact same `runHighLevelContactSync` the manual "Sync from
 * Loop" button uses (lib/intake/reviewActions.ts) — its own internal lock
 * means an overlapping manual click and scheduled tick can't double-run.
 */
export async function GET(request: NextRequest) {
  let secret: string;
  try {
    secret = readHighLevelSyncCronSecret();
  } catch (error) {
    console.error("[cron/highlevel-sync] cron secret not configured", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  if (!isAuthorizedBearerToken(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runHighLevelContactSync("scheduled", null);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[cron/highlevel-sync] sync failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
