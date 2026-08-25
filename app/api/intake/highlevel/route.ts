import { NextRequest, NextResponse } from "next/server";

import { readHighLevelWebhookSecret } from "@/lib/intake/config";
import { ingestHighLevelContactEvent } from "@/lib/intake/ingest";
import { isAuthorizedBearerToken } from "@/lib/intake/webhookAuth";

/**
 * Inbound HighLevel intake webhook — see lib/intake/README.md and
 * docs/INTEGRATION_ARCHITECTURE.md for the full boundary. Excluded from
 * proxy.ts's session-auth gate (a webhook delivery has no session cookie)
 * and instead enforces its own shared-secret check below. Delegates
 * everything else to lib/intake/ingest.ts so the actual logic stays
 * unit-testable without an HTTP request.
 *
 * Always responds 200 for a request that authenticated, regardless of
 * ingest outcome (including "malformed") — a webhook sender should not be
 * made to retry indefinitely over data this app already understands as a
 * permanent, non-transient rejection. Only an authentication failure
 * (401) or a genuine unexpected server error (500) get a non-2xx status.
 */
export async function POST(request: NextRequest) {
  let secret: string;
  try {
    secret = readHighLevelWebhookSecret();
  } catch (error) {
    console.error("[intake/highlevel] webhook secret not configured", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  if (!isAuthorizedBearerToken(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ received: true, outcome: "ignored" }, { status: 200 });
  }

  try {
    const result = await ingestHighLevelContactEvent(body);
    return NextResponse.json({ received: true, outcome: result.outcome }, { status: 200 });
  } catch (error) {
    console.error("[intake/highlevel] ingest failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
