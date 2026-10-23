"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/matters/actions";
import { NOTIFICATION_KIND_VALUES } from "@/lib/notifications/labels";

/**
 * Inbox state changes. Every update is scoped to the caller's own
 * notifications (`userId` in the WHERE clause), so a forged id belonging
 * to someone else simply matches nothing. Notification state is personal
 * UI state, not case data, so no AuditEvent is written.
 */

const NOT_FOUND = "Not found or access denied.";
const idSchema = z.object({ notificationId: z.string().trim().min(1).max(100) });

async function updateOwn(input: { notificationId: string }, data: { readAt?: Date | null; dismissedAt?: Date | null }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const result = await prisma.notification.updateMany({ where: { id: parsed.data.notificationId, userId: user.id }, data });
  if (result.count === 0) return { ok: false, error: NOT_FOUND };
  revalidatePath("/notifications");
  return { ok: true, data: undefined };
}

export async function markNotificationRead(input: { notificationId: string }): Promise<ActionResult> {
  return updateOwn(input, { readAt: new Date() });
}

export async function markNotificationUnread(input: { notificationId: string }): Promise<ActionResult> {
  return updateOwn(input, { readAt: null, dismissedAt: null });
}

export async function dismissNotification(input: { notificationId: string }): Promise<ActionResult> {
  return updateOwn(input, { dismissedAt: new Date(), readAt: new Date() });
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const user = await requireCurrentUser();
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null, dismissedAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
  return { ok: true, data: undefined };
}

const preferenceSchema = z.object({ kind: z.enum(NOTIFICATION_KIND_VALUES), inApp: z.boolean() });

export async function setNotificationPreference(input: { kind: string; inApp: boolean }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const parsed = preferenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid preference." };
  await prisma.notificationPreference.upsert({
    where: { userId_kind: { userId: user.id, kind: parsed.data.kind } },
    create: { userId: user.id, kind: parsed.data.kind, inApp: parsed.data.inApp },
    update: { inApp: parsed.data.inApp },
  });
  revalidatePath("/account/notifications");
  return { ok: true, data: undefined };
}
