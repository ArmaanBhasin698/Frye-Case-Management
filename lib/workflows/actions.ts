"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import type { ActionResult } from "@/lib/matters/actions";
import { anchorSchema, applySchema, readTemplateFields, type StepFields } from "@/lib/workflows/fields";
import { canApplyWorkflow, getMatterTeam, getVersionForApply } from "@/lib/workflows/queries";
import { buildPreview, isEventMovable, isTaskMovable, scheduleStep, type PreviewItem } from "@/lib/workflows/schedule";
import { installStarterTemplates } from "@/lib/workflows/starters";

/**
 * Workflow template management (ADMIN-only) and application to matters
 * (ADMIN, or an ATTORNEY/PARALEGAL assigned to the matter). Every action
 * re-checks permissions and recomputes schedules/assignees server-side —
 * a preview is never trusted. Audit metadata holds ids, versions, and
 * counts only, never step titles or descriptions.
 */

export type FormState = { error: string | null };
export type ApplyState = { error: string | null; applicationId?: string; duplicate?: boolean };

const NOT_FOUND = "Not found or access denied.";
const id = z.string().trim().min(1).max(100);

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** A SPECIFIC_USER step must name an existing, active account. */
async function validateStepUsers(steps: StepFields[]): Promise<string | null> {
  const ids = [...new Set(steps.map((s) => s.assigneeUserId).filter((v): v is string => Boolean(v)))];
  if (ids.length === 0) return null;
  const found = await prisma.user.count({ where: { id: { in: ids }, status: "ACTIVE" } });
  return found === ids.length ? null : "Choose active staff members for specific-user steps.";
}

function stepRows(steps: StepFields[]) {
  return steps.map((s, position) => ({ ...s, position }));
}

// --- Template management (ADMIN) -------------------------------------------------

export async function createWorkflowTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const parsed = readTemplateFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid template." };
  const fields = parsed.data;
  const userError = await validateStepUsers(fields.steps);
  if (userError) return { error: userError };

  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.workflowTemplate.create({
      data: {
        name: fields.name,
        description: fields.description,
        category: fields.category,
        createdById: user.id,
        versions: { create: { version: 1, createdById: user.id, steps: { create: stepRows(fields.steps) } } },
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: user.id,
        action: "CREATE",
        entityType: "WorkflowTemplate",
        entityId: created.id,
        metadata: { version: 1, steps: fields.steps.length, category: fields.category },
      },
    });
    return created;
  });

  revalidatePath("/admin/workflows");
  redirect(`/admin/workflows/${template.id}`);
}

/**
 * Editing never mutates an existing version: it writes the next immutable
 * version. Workflows already applied keep pointing at the version they used.
 */
export async function saveWorkflowTemplateVersion(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const templateId = id.safeParse(formData.get("templateId"));
  if (!templateId.success) return { error: NOT_FOUND };
  const parsed = readTemplateFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid template." };
  const fields = parsed.data;
  const userError = await validateStepUsers(fields.steps);
  if (userError) return { error: userError };

  const template = await prisma.workflowTemplate.findUnique({ where: { id: templateId.data }, select: { id: true } });
  if (!template) return { error: NOT_FOUND };

  try {
    await prisma.$transaction(async (tx) => {
      const latest = await tx.workflowTemplateVersion.aggregate({ where: { templateId: template.id }, _max: { version: true } });
      const version = (latest._max.version ?? 0) + 1;
      await tx.workflowTemplate.update({
        where: { id: template.id },
        data: { name: fields.name, description: fields.description, category: fields.category },
      });
      await tx.workflowTemplateVersion.create({
        data: { templateId: template.id, version, createdById: user.id, steps: { create: stepRows(fields.steps) } },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "UPDATE",
          entityType: "WorkflowTemplate",
          entityId: template.id,
          metadata: { version, steps: fields.steps.length },
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Someone saved this template at the same time — reload and try again." };
    throw error;
  }

  revalidatePath("/admin/workflows");
  revalidatePath(`/admin/workflows/${template.id}`);
  return { error: null };
}

export async function setWorkflowTemplateStatus(input: { templateId: string; status: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { ok: false, error: NOT_FOUND };
  const parsed = z.object({ templateId: id, status: z.enum(["ACTIVE", "ARCHIVED"]) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const existing = await prisma.workflowTemplate.findUnique({ where: { id: parsed.data.templateId }, select: { status: true } });
  if (!existing) return { ok: false, error: NOT_FOUND };

  await prisma.$transaction([
    prisma.workflowTemplate.update({ where: { id: parsed.data.templateId }, data: { status: parsed.data.status } }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "WorkflowTemplate",
        entityId: parsed.data.templateId,
        metadata: { status: { before: existing.status, after: parsed.data.status } },
      },
    }),
  ]);
  revalidatePath("/admin/workflows");
  revalidatePath(`/admin/workflows/${parsed.data.templateId}`);
  return { ok: true, data: undefined };
}

export async function installStarterWorkflowTemplates(): Promise<ActionResult<{ created: string[] }>> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { ok: false, error: NOT_FOUND };
  const created = await installStarterTemplates(prisma, user.id);
  if (created.length > 0) {
    await prisma.auditEvent.create({
      data: { actorId: user.id, action: "CREATE", entityType: "WorkflowTemplate", entityId: "starter-templates", metadata: { installed: created.length } },
    });
  }
  revalidatePath("/admin/workflows");
  return { ok: true, data: { created } };
}

// --- Applying to a matter -----------------------------------------------------------

type ApplyContext =
  | { error: string }
  | {
      version: NonNullable<Awaited<ReturnType<typeof getVersionForApply>>>;
      team: Awaited<ReturnType<typeof getMatterTeam>>;
    };

async function loadApplyContext(user: AuthorizableUser, matterId: string, templateVersionId: string): Promise<ApplyContext> {
  if (!(await canApplyWorkflow(user, matterId))) return { error: NOT_FOUND };
  const matter = await prisma.matter.findUnique({ where: { id: matterId }, select: { id: true } });
  if (!matter) return { error: NOT_FOUND };
  const version = await getVersionForApply(templateVersionId);
  if (!version) return { error: NOT_FOUND };
  if (!version.isLatestActive) {
    return { error: "This template changed or was archived since the preview — preview it again." };
  }
  return { version, team: await getMatterTeam(matterId) };
}

export async function previewWorkflow(input: {
  matterId: string;
  templateVersionId: string;
  anchorDate: string;
  timeZone: string;
}): Promise<ActionResult<{ items: PreviewItem[]; templateName: string; version: number }>> {
  const user = await requireCurrentUser();
  const parsed = applySchema.omit({ requestKey: true }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const ctx = await loadApplyContext(user, parsed.data.matterId, parsed.data.templateVersionId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  return {
    ok: true,
    data: {
      items: buildPreview(ctx.version.steps, parsed.data.anchorDate, parsed.data.timeZone, ctx.team),
      templateName: ctx.version.templateName,
      version: ctx.version.version,
    },
  };
}

/**
 * Applies a template version atomically: the WorkflowApplication and every
 * Task/CalendarEvent are created in one transaction (any failure rolls all
 * of it back). `requestKey` is unique — resubmitting the same form returns
 * the original application instead of duplicating; a fresh form (new key)
 * is a deliberate separate application.
 */
export async function applyWorkflow(_prev: ApplyState, formData: FormData): Promise<ApplyState> {
  const user = await requireCurrentUser();
  const parsed = applySchema.safeParse({
    matterId: formData.get("matterId"),
    templateVersionId: formData.get("templateVersionId"),
    anchorDate: formData.get("anchorDate"),
    timeZone: formData.get("timeZone"),
    requestKey: formData.get("requestKey"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { matterId, templateVersionId, anchorDate, timeZone, requestKey } = parsed.data;

  const prior = await prisma.workflowApplication.findUnique({ where: { requestKey }, select: { id: true, matterId: true } });
  if (prior) {
    if (prior.matterId !== matterId) return { error: NOT_FOUND };
    return { error: null, applicationId: prior.id, duplicate: true };
  }

  const ctx = await loadApplyContext(user, matterId, templateVersionId);
  if ("error" in ctx) return { error: ctx.error };
  const items = buildPreview(ctx.version.steps, anchorDate, timeZone, ctx.team);
  const stepsById = new Map(ctx.version.steps.map((s) => [s.id, s]));
  const [year, month, day] = anchorDate.split("-").map(Number) as [number, number, number];

  let applicationId: string;
  try {
    applicationId = await prisma.$transaction(async (tx) => {
      const application = await tx.workflowApplication.create({
        data: {
          matterId,
          templateVersionId,
          anchorDate: new Date(Date.UTC(year, month - 1, day)),
          timeZone,
          requestKey,
          appliedById: user.id,
        },
      });
      let tasks = 0;
      let events = 0;
      for (const item of items) {
        const step = stepsById.get(item.stepId)!;
        if (item.schedule.kind === "TASK") {
          await tx.task.create({
            data: {
              matterId,
              title: step.title,
              description: step.description,
              priority: step.priority,
              dueDate: item.schedule.dueDate,
              assignedToId: item.assignee.userId,
              workflowApplicationId: application.id,
              workflowStepId: step.id,
            },
          });
          tasks += 1;
        } else {
          await tx.calendarEvent.create({
            data: {
              matterId,
              title: step.title,
              description: step.description,
              type: step.eventType ?? "OTHER",
              startTime: item.schedule.startTime,
              endTime: item.schedule.endTime,
              allDay: item.schedule.allDay,
              timeZone,
              createdById: user.id,
              workflowApplicationId: application.id,
              workflowStepId: step.id,
              attendees: { create: item.assignee.userId ? [{ userId: item.assignee.userId }] : [] },
            },
          });
          events += 1;
        }
      }
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "WorkflowApplication",
          entityId: application.id,
          matterId,
          metadata: { templateId: ctx.version.templateId, version: ctx.version.version, tasks, events },
        },
      });
      return application.id;
    });
  } catch (error) {
    // A concurrent submit with the same key won the race — return its result.
    if (isUniqueViolation(error)) {
      const winner = await prisma.workflowApplication.findUnique({ where: { requestKey }, select: { id: true, matterId: true } });
      if (winner && winner.matterId === matterId) return { error: null, applicationId: winner.id, duplicate: true };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) return { error: "The workflow couldn't be applied; nothing was created." };
    throw error;
  }

  revalidatePath(`/matters/${matterId}/workflows`);
  revalidatePath(`/matters/${matterId}/tasks`);
  revalidatePath(`/matters/${matterId}/deadlines`);
  revalidatePath("/calendar");
  return { error: null, applicationId };
}

// --- Recalculation ------------------------------------------------------------------

export type RecalculationPlan = {
  moves: { kind: "TASK" | "EVENT"; id: string; title: string; from: Date | null; to: Date }[];
  skipped: { kind: "TASK" | "EVENT"; id: string; title: string; reason: string }[];
};

async function planRecalculation(user: AuthorizableUser, applicationId: string, anchorDate: string): Promise<
  { error: string } | { plan: RecalculationPlan; matterId: string; timeZone: string }
> {
  const application = await prisma.workflowApplication.findUnique({
    where: { id: applicationId },
    include: {
      tasks: { include: { workflowStep: true } },
      events: { include: { workflowStep: true } },
    },
  });
  if (!application || !(await canApplyWorkflow(user, application.matterId))) return { error: NOT_FOUND };
  const now = new Date();
  const plan: RecalculationPlan = { moves: [], skipped: [] };
  for (const task of application.tasks) {
    if (!task.workflowStep) plan.skipped.push({ kind: "TASK", id: task.id, title: task.title, reason: "Step no longer linked" });
    else if (!isTaskMovable(task.status)) plan.skipped.push({ kind: "TASK", id: task.id, title: task.title, reason: "Completed or cancelled" });
    else {
      const next = scheduleStep(task.workflowStep, anchorDate, application.timeZone);
      if (next.kind === "TASK") plan.moves.push({ kind: "TASK", id: task.id, title: task.title, from: task.dueDate, to: next.dueDate });
    }
  }
  for (const event of application.events) {
    if (!event.workflowStep) plan.skipped.push({ kind: "EVENT", id: event.id, title: event.title, reason: "Step no longer linked" });
    else if (!isEventMovable(event, now)) plan.skipped.push({ kind: "EVENT", id: event.id, title: event.title, reason: "Past, cancelled, or completed" });
    else {
      const next = scheduleStep(event.workflowStep, anchorDate, application.timeZone);
      if (next.kind === "EVENT") plan.moves.push({ kind: "EVENT", id: event.id, title: event.title, from: event.startTime, to: next.startTime });
    }
  }
  return { plan, matterId: application.matterId, timeZone: application.timeZone };
}

export async function previewWorkflowRecalculation(input: { applicationId: string; anchorDate: string }): Promise<ActionResult<RecalculationPlan>> {
  const user = await requireCurrentUser();
  const parsed = z.object({ applicationId: id, anchorDate: anchorSchema.shape.anchorDate }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const result = await planRecalculation(user, parsed.data.applicationId, parsed.data.anchorDate);
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, data: result.plan };
}

/**
 * Moves the still-open items of one application to a new anchor after an
 * explicit confirmation. Completed/cancelled tasks, past or cancelled
 * events, and legal Deadlines are never touched.
 */
export async function recalculateWorkflow(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCurrentUser();
  const parsed = z
    .object({ applicationId: id, anchorDate: anchorSchema.shape.anchorDate, confirm: z.literal("on") })
    .safeParse({ applicationId: formData.get("applicationId"), anchorDate: formData.get("anchorDate"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: "Preview the change and confirm it before recalculating." };
  const result = await planRecalculation(user, parsed.data.applicationId, parsed.data.anchorDate);
  if ("error" in result) return { error: result.error };
  const [year, month, day] = parsed.data.anchorDate.split("-").map(Number) as [number, number, number];

  await prisma.$transaction(async (tx) => {
    for (const move of result.plan.moves) {
      if (move.kind === "TASK") {
        await tx.task.update({ where: { id: move.id }, data: { dueDate: move.to } });
      } else {
        const event = await tx.calendarEvent.findUniqueOrThrow({ where: { id: move.id }, select: { startTime: true, endTime: true } });
        const duration = event.endTime ? event.endTime.getTime() - event.startTime.getTime() : null;
        await tx.calendarEvent.update({
          where: { id: move.id },
          data: { startTime: move.to, endTime: duration === null ? null : new Date(move.to.getTime() + duration) },
        });
      }
    }
    await tx.workflowApplication.update({
      where: { id: parsed.data.applicationId },
      data: { anchorDate: new Date(Date.UTC(year, month - 1, day)), recalculatedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "WorkflowApplication",
        entityId: parsed.data.applicationId,
        matterId: result.matterId,
        metadata: { recalculated: true, moved: result.plan.moves.length, skipped: result.plan.skipped.length },
      },
    });
  });

  revalidatePath(`/matters/${result.matterId}/workflows`);
  revalidatePath(`/matters/${result.matterId}/tasks`);
  revalidatePath("/calendar");
  return { error: null };
}
