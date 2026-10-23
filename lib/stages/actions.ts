"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { canEditMatter } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { ensureSuggestedStages } from "@/lib/stages/suggested";

/**
 * Case-stage Server Actions. Stage *definitions* are ADMIN-only. Setting a
 * matter's stage requires canEditMatter (ADMIN, or an ATTORNEY assigned to
 * the matter) — the same rule as editing the matter's case details.
 *
 * A stage is progress metadata only: these actions write `Matter.stageId`
 * and nothing else on the matter — never status, closedDate, archived, or
 * closure state (closing/reopening stays in lib/history/actions.ts).
 */

export type FormActionState = { error: string | null };
const NOT_FOUND = "Not found or access denied.";
const id = z.string().trim().min(1).max(100);
const name = z.string().trim().min(1, "Stage name is required.").max(60, "Stage name is too long.");

function revalidateStages() {
  revalidatePath("/admin/stages");
  revalidatePath("/matters");
}

async function nameTaken(candidate: string, exceptId?: string) {
  const count = await prisma.matterStage.count({
    where: { name: { equals: candidate, mode: "insensitive" }, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  return count > 0;
}

export async function createStage(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const parsed = name.safeParse(formData.get("name") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };
  if (await nameTaken(parsed.data)) return { error: "An active stage already has that name." };

  const last = await prisma.matterStage.aggregate({ _max: { position: true } });
  const stage = await prisma.matterStage.create({ data: { name: parsed.data, position: (last._max.position ?? 0) + 1 } });
  await prisma.auditEvent.create({
    data: { actorId: user.id, action: "CREATE", entityType: "MatterStage", entityId: stage.id, metadata: { position: stage.position } },
  });
  revalidateStages();
  return { error: null };
}

export async function renameStage(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const stageId = id.safeParse(formData.get("stageId"));
  const parsed = name.safeParse(formData.get("name") ?? "");
  if (!stageId.success) return { error: NOT_FOUND };
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };
  const stage = await prisma.matterStage.findUnique({ where: { id: stageId.data } });
  if (!stage) return { error: NOT_FOUND };
  if (await nameTaken(parsed.data, stage.id)) return { error: "An active stage already has that name." };

  await prisma.$transaction([
    prisma.matterStage.update({ where: { id: stage.id }, data: { name: parsed.data } }),
    prisma.auditEvent.create({
      data: { actorId: user.id, action: "UPDATE", entityType: "MatterStage", entityId: stage.id, metadata: { changed: ["name"] } },
    }),
  ]);
  revalidateStages();
  return { error: null };
}

/** Swaps a stage with its neighbour in the ordered list. */
export async function moveStage(input: { stageId: string; direction: "up" | "down" }): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const parsed = z.object({ stageId: id, direction: z.enum(["up", "down"]) }).safeParse(input);
  if (!parsed.success) return { error: NOT_FOUND };

  const stages = await prisma.matterStage.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  const index = stages.findIndex((s) => s.id === parsed.data.stageId);
  if (index === -1) return { error: NOT_FOUND };
  const otherIndex = parsed.data.direction === "up" ? index - 1 : index + 1;
  if (otherIndex < 0 || otherIndex >= stages.length) return { error: null };

  // Renumber densely so equal/duplicate positions can't make swaps no-ops.
  const order = stages.map((s) => s.id);
  [order[index], order[otherIndex]] = [order[otherIndex]!, order[index]!];
  await prisma.$transaction([
    ...order.map((stageId, i) => prisma.matterStage.update({ where: { id: stageId }, data: { position: i + 1 } })),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "MatterStage",
        entityId: parsed.data.stageId,
        metadata: { changed: ["position"], direction: parsed.data.direction },
      },
    }),
  ]);
  revalidateStages();
  return { error: null };
}

/**
 * Archiving hides a stage from new assignment; matters already in it keep
 * it (and still display it). Restoring is refused if an active stage now
 * has the same name.
 */
export async function setStageArchived(input: { stageId: string; archived: boolean }): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const parsed = z.object({ stageId: id, archived: z.boolean() }).safeParse(input);
  if (!parsed.success) return { error: NOT_FOUND };
  const stage = await prisma.matterStage.findUnique({ where: { id: parsed.data.stageId } });
  if (!stage) return { error: NOT_FOUND };
  if (!parsed.data.archived && (await nameTaken(stage.name, stage.id))) {
    return { error: "An active stage already has that name — rename one first." };
  }

  await prisma.$transaction([
    prisma.matterStage.update({ where: { id: stage.id }, data: { archivedAt: parsed.data.archived ? new Date() : null } }),
    prisma.auditEvent.create({
      data: { actorId: user.id, action: "UPDATE", entityType: "MatterStage", entityId: stage.id, metadata: { archived: parsed.data.archived } },
    }),
  ]);
  revalidateStages();
  return { error: null };
}

export async function installSuggestedStages(): Promise<FormActionState & { created?: number }> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const created = await ensureSuggestedStages(prisma);
  if (created.length > 0) {
    await prisma.auditEvent.create({
      data: { actorId: user.id, action: "CREATE", entityType: "MatterStage", entityId: "suggested", metadata: { createdCount: created.length } },
    });
  }
  revalidateStages();
  return { error: null, created: created.length };
}

/**
 * Sets (or clears, with an empty stageId) a matter's stage and appends a
 * MatterStageChange. Archived stages can't be newly assigned. Touches only
 * `stageId` — never status, closedDate, archived, or closure.
 */
export async function setMatterStage(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const matterId = id.safeParse(formData.get("matterId"));
  if (!matterId.success || !(await canEditMatter(user, matterId.data))) return { error: NOT_FOUND };
  const rawStage = String(formData.get("stageId") ?? "").trim();
  const nextStageId = rawStage === "" ? null : rawStage;

  const matter = await prisma.matter.findUnique({ where: { id: matterId.data }, select: { stageId: true } });
  if (!matter) return { error: NOT_FOUND };
  if (matter.stageId === nextStageId) return { error: null };
  if (nextStageId) {
    const stage = await prisma.matterStage.findUnique({ where: { id: nextStageId }, select: { archivedAt: true } });
    if (!stage) return { error: "Choose a valid stage." };
    if (stage.archivedAt) return { error: "That stage is archived and can't be newly assigned." };
  }

  await prisma.$transaction([
    prisma.matter.update({ where: { id: matterId.data }, data: { stageId: nextStageId } }),
    prisma.matterStageChange.create({
      data: { matterId: matterId.data, fromStageId: matter.stageId, toStageId: nextStageId, changedById: user.id },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Matter",
        entityId: matterId.data,
        matterId: matterId.data,
        metadata: { changed: { stageId: { before: matter.stageId, after: nextStageId } } },
      },
    }),
  ]);

  revalidatePath(`/matters/${matterId.data}`);
  revalidatePath("/matters");
  return { error: null };
}
