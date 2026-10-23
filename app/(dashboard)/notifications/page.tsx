import Link from "next/link";
import { format } from "date-fns";

import { requireCurrentUser } from "@/lib/auth/session";
import { listNotifications, type NotificationView } from "@/lib/notifications/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MarkAllReadButton, NotificationItemActions } from "@/components/shared/notification-controls";

const VIEWS: { value: NotificationView; label: string }[] = [
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
  { value: "dismissed", label: "Dismissed" },
];

/**
 * In-app notification inbox. Every row is re-checked against the user's
 * current access when listed (lib/notifications/queries.ts), and opening
 * one goes through the normal, independently authorized page. Delivery is
 * in-app only — no email, SMS, or push channel is connected.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const requested = typeof params.view === "string" ? params.view : "unread";
  const view: NotificationView = VIEWS.some((v) => v.value === requested) ? (requested as NotificationView) : "unread";
  const notifications = await listNotifications(user, view);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            In-app reminders for your tasks, deadlines, events, and direct messages. Email/SMS/push delivery is not
            connected.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {view === "unread" && notifications.length > 0 && <MarkAllReadButton />}
          <Button variant="outline" size="sm" asChild>
            <Link href="/account/notifications">Preferences</Link>
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        {VIEWS.map((v) => (
          <Button key={v.value} variant={v.value === view ? "default" : "outline"} size="sm" asChild>
            <Link href={v.value === "unread" ? "/notifications" : `/notifications?view=${v.value}`}>{v.label}</Link>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {notifications.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No {view} notifications.</p>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                  <div className="min-w-0">
                    <Link href={n.href} className="font-medium text-foreground hover:underline">
                      {n.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {[n.detail, n.caseNumber, format(n.createdAt, "MMM d, yyyy h:mm a")].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!n.readAt && !n.dismissedAt && <Badge>New</Badge>}
                    <NotificationItemActions id={n.id} read={Boolean(n.readAt)} dismissed={Boolean(n.dismissedAt)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
