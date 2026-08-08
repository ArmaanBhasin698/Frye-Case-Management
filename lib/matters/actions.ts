"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { TaskPriority, TaskStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";

/**
 * Server Actions backing the write paths on a Matter (notes, tasks, call
 * filing). Every action here independently re-checks authentication and
 * matter-level access rather than trusting that the caller already passed
 * through the matter layout's check (see CLAUDE.md, section 4.4 and
 * docs/SECURITY.md) — Server Actions can be invoked directly, not just via
 * a page render.
 *
 * Failure responses are intentionally generic ("Not found or access
 * denied.") so a denied write can't be used to probe for the existence of
 * a matter or record the caller isn't authorized to see.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const NOT_FOUND = { ok: false, error: "Not found or access denied." } satisfies ActionResult<never>;

/**
 * State shape for `useActionState`-backed forms. Always a fresh object
 * (never bare `undefined`) so a client effect keyed on this value can tell
 * "just succeeded" apart from "hasn't submitted yet" even when both have
 * no error — two literal `undefined`s are indistinguishable by reference,
 * two object literals never are.
 */
export type FormActionState = { error: string | null };
const FORM_OK: FormActionState = { error: null };

const TASK_STATUS_VALUES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const satisfies readonly TaskStatus[];
const TASK_PRIORITY_VALUES = ["LOW", "NORMAL", "HIGH"] as const satisfies readonly TaskPriority[];

const cuid = z.string().min(1, "Required.");

// --- Notes -----------------------------------------------------------------

const createNoteSchema = z.object({
  matterId: cuid,
  body: z.string().trim().min(1, "Note text is required.").max(10_000, "Note is too long."),
});

export async function createNote(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const parsed = createNoteSchema.safeParse({
    matterId: formData.get("matterId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, body } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  const note = await prisma.note.create({
    data: { matterId, authorId: user.id, body },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "Note",
      entityId: note.id,
      matterId,
    },
  });

  revalidatePath(`/matters/${matterId}/notes`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { ...FORM_OK };
}

// --- Tasks -------------------------------------------------------------

const createTaskSchema = z.object({
  matterId: cuid,
  title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
  description: z
    .string()
    .trim()
    .max(2_000, "Description is too long.")
    .optional()
    .transform((v) => (v ? v : undefined)),
  dueDate: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Invalid due date."),
  priority: z.enum(TASK_PRIORITY_VALUES).default("NORMAL"),
});

export async function createTask(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const parsed = createTaskSchema.safeParse({
    matterId: formData.get("matterId"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    dueDate: formData.get("dueDate") ?? undefined,
    priority: formData.get("priority") || "NORMAL",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, title, description, dueDate, priority } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  const task = await prisma.task.create({
    data: {
      matterId,
      title,
      description,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      priority,
    },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "Task",
      entityId: task.id,
      matterId,
    },
  });

  revalidatePath(`/matters/${matterId}/tasks`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { ...FORM_OK };
}

const updateTaskStatusSchema = z.object({
  matterId: cuid,
  taskId: cuid,
  status: z.enum(TASK_STATUS_VALUES),
});

/** Called directly from the Kanban board's onDrop handler, not a <form>. */
export async function updateTaskStatus(input: {
  matterId: string;
  taskId: string;
  status: TaskStatus;
}): Promise<ActionResult> {
  const user = await requireCurrentUser();

  const parsed = updateTaskStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, taskId, status } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return NOT_FOUND;
  }

  // Scope the update by matterId too, so a task id from a different matter
  // (even one the caller can access) can never be moved via this matter's
  // board.
  const result = await prisma.task.updateMany({
    where: { id: taskId, matterId },
    data: { status },
  });
  if (result.count === 0) {
    return NOT_FOUND;
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "UPDATE",
      entityType: "Task",
      entityId: taskId,
      matterId,
      metadata: { status },
    },
  });

  revalidatePath(`/matters/${matterId}/tasks`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { ok: true, data: undefined };
}

// --- Calls -------------------------------------------------------------

const attachCallSchema = z.object({
  matterId: cuid,
  callId: cuid,
});

/** Called directly from the Calls tab's "Attach" button, not a <form>. */
export async function attachCallToMatter(input: {
  matterId: string;
  callId: string;
}): Promise<ActionResult> {
  const user = await requireCurrentUser();

  const parsed = attachCallSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, callId } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return NOT_FOUND;
  }

  // Only ever attach a call that is still unfiled — never re-parent a call
  // that's already on another matter, and never leak whether `callId`
  // belongs to someone else's matter vs. not existing at all.
  const result = await prisma.call.updateMany({
    where: { id: callId, matterId: null },
    data: { matterId, filedById: user.id, filedAt: new Date() },
  });
  if (result.count === 0) {
    return NOT_FOUND;
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "UPDATE",
      entityType: "Call",
      entityId: callId,
      matterId,
      metadata: { attached: true },
    },
  });

  revalidatePath(`/matters/${matterId}/calls`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  revalidatePath("/");
  return { ok: true, data: undefined };
}
