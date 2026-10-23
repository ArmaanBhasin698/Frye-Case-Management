"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { REPORT_KINDS, canRunReportKind, parseReportFilters } from "@/lib/reports/saved";

/**
 * Saved-report writes. Reports belong to their owner only: every write is
 * scoped by `ownerId = current user`, so a forged id simply matches
 * nothing. Saving stores filters only; nothing about the owner's current
 * privileges is captured. Audit metadata carries the kind, never filter
 * values (which can include search text or names).
 */

export type FormActionState = { error: string | null };
const NOT_FOUND = "Not found or access denied.";
const name = z.string().trim().min(1, "Name the report.").max(120, "Name is too long.");

export async function saveReport(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const kind = z.enum(REPORT_KINDS).safeParse(formData.get("kind"));
  const parsedName = name.safeParse(formData.get("name") ?? "");
  if (!kind.success) return { error: "Choose a report type." };
  if (!parsedName.success) return { error: parsedName.error.issues[0]?.message ?? "Name the report." };
  if (!canRunReportKind(user, kind.data)) return { error: NOT_FOUND };

  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) if (key.startsWith("f_")) raw[key.slice(2)] = String(value);
  const filters = parseReportFilters(kind.data, raw);
  if (!filters.ok) return { error: "Those filters aren't valid for this report type." };

  const report = await prisma.savedReport.create({
    data: { ownerId: user.id, name: parsedName.data, kind: kind.data, filters: filters.filters },
  });
  await prisma.auditEvent.create({
    data: { actorId: user.id, action: "CREATE", entityType: "SavedReport", entityId: report.id, metadata: { kind: kind.data } },
  });
  revalidatePath("/reports/saved");
  redirect(`/reports/saved/${report.id}`);
}

export async function renameReport(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const reportId = z.string().min(1).max(100).safeParse(formData.get("reportId"));
  const parsedName = name.safeParse(formData.get("name") ?? "");
  if (!reportId.success) return { error: NOT_FOUND };
  if (!parsedName.success) return { error: parsedName.error.issues[0]?.message ?? "Name the report." };
  const result = await prisma.savedReport.updateMany({
    where: { id: reportId.data, ownerId: user.id },
    data: { name: parsedName.data },
  });
  if (result.count === 0) return { error: NOT_FOUND };
  await prisma.auditEvent.create({
    data: { actorId: user.id, action: "UPDATE", entityType: "SavedReport", entityId: reportId.data, metadata: { renamed: true } },
  });
  revalidatePath("/reports/saved");
  revalidatePath(`/reports/saved/${reportId.data}`);
  return { error: null };
}

export async function deleteReport(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const reportId = z.string().min(1).max(100).safeParse(formData.get("reportId"));
  if (!reportId.success) return { error: NOT_FOUND };
  const result = await prisma.savedReport.deleteMany({ where: { id: reportId.data, ownerId: user.id } });
  if (result.count === 0) return { error: NOT_FOUND };
  await prisma.auditEvent.create({
    data: { actorId: user.id, action: "DELETE", entityType: "SavedReport", entityId: reportId.data, metadata: {} },
  });
  revalidatePath("/reports/saved");
  redirect("/reports/saved");
}
