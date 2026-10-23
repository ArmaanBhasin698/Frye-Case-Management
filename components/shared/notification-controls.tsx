"use client";

import * as React from "react";
import type { NotificationKind } from "@prisma/client";

import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  setNotificationPreference,
} from "@/lib/notifications/actions";
import { Button } from "@/components/ui/button";

function useRun() {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setPending(true);
    const result = await action();
    setPending(false);
    if (!result.ok) setError(result.error ?? "Something went wrong.");
  }
  return { pending, error, run };
}

/** Per-notification read/unread/dismiss controls; the server only touches the caller's own rows. */
export function NotificationItemActions({ id, read, dismissed }: { id: string; read: boolean; dismissed: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {!dismissed &&
        (read ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => markNotificationUnread({ notificationId: id }))}>
            Mark unread
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => markNotificationRead({ notificationId: id }))}>
            Mark read
          </Button>
        ))}
      {dismissed ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => markNotificationUnread({ notificationId: id }))}>
          Restore
        </Button>
      ) : (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => dismissNotification({ notificationId: id }))}>
          Dismiss
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function MarkAllReadButton() {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => markAllNotificationsRead())}>
        Mark all read
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function NotificationPreferenceToggle({ kind, enabled }: { kind: NotificationKind; enabled: boolean }) {
  const [checked, setChecked] = React.useState(enabled);
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="checkbox"
        aria-label={`In-app notifications: ${kind}`}
        checked={checked}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setChecked(next);
          void run(() => setNotificationPreference({ kind, inApp: next }));
        }}
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
