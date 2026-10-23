import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getConversationMessages } from "@/lib/chat/queries";

/**
 * Polling endpoint for the chat view (no real-time dependency — see
 * docs/FIRM_OPERATIONS_EXPANSION.md). Every call re-resolves the session
 * and re-runs the full conversation access check (membership + matter
 * access), so a revoked user stops receiving messages on their next poll.
 * Every failure is the same generic 404. `?before=<ISO date>` pages back
 * through history.
 */
export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Not found.", { status: 404 });

  const beforeParam = new URL(request.url).searchParams.get("before");
  const before = beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? new Date(beforeParam) : undefined;

  const result = await getConversationMessages(user, conversationId, { before });
  if (!result) return new NextResponse("Not found.", { status: 404 });

  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
