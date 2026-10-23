import { requireCurrentUser } from "@/lib/auth/session";
import { getPreferences } from "@/lib/notifications/queries";
import { NOTIFICATION_KIND_LABELS, NOTIFICATION_KIND_VALUES } from "@/lib/notifications/labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationPreferenceToggle } from "@/components/shared/notification-controls";

/** The signed-in user's own in-app notification preferences. External channels are not connected. */
export default async function NotificationPreferencesPage() {
  const user = await requireCurrentUser();
  const preferences = await getPreferences(user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="page-title">Notification preferences</h1>
        <p className="text-sm text-muted-foreground">
          Choose which in-app notifications you receive. Turning one off stops new notifications of that kind; email,
          SMS, and push delivery are not connected.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>In-app notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {NOTIFICATION_KIND_VALUES.map((kind) => (
              <li key={kind} className="flex items-center justify-between py-2 text-sm">
                <span>{NOTIFICATION_KIND_LABELS[kind]}</span>
                <NotificationPreferenceToggle kind={kind} enabled={preferences[kind]} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
