import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { countUnreadNotifications } from "@/lib/notifications/queries";

/** Unread badge count for the signed-in user only (access-scoped like the inbox). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const unread = await countUnreadNotifications(user);
  return NextResponse.json({ unread }, { headers: { "Cache-Control": "no-store" } });
}
