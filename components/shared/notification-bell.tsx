"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

const POLL_MS = 30_000;

/**
 * Header bell with the signed-in user's unread in-app notification count.
 * Polls an authenticated, access-scoped route every 30 s and on window
 * focus; shows no number when the count can't be fetched.
 */
export function NotificationBell() {
  const [unread, setUnread] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch("/api/notifications/unread-count", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { unread?: number };
        if (!cancelled && typeof body.unread === "number") setUnread(body.unread);
      } catch {
        // Network hiccup: keep the last known count.
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      className="relative rounded-md p-2 hover:bg-accent"
      aria-label={unread ? `Notifications (${unread} unread)` : "Notifications"}
      title="Notifications"
    >
      <Bell className="h-5 w-5" />
      {unread !== null && unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-primary-foreground">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
