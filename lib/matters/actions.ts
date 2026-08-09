"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { AssignmentRole, MatterStatus, TaskPriority, TaskStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { canEditMatter, hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import { canManageClientsAndMatters } from "@/lib/auth/authorization";
import { diffFields } from "@/lib/utils";

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
const MATTER_STATUS_VALUES = ["OPEN", "PENDING", "CLOSED"] as const satisfies readonly MatterStatus[];
const ASSIGNMENT_ROLE_VALUES = [
  "LEAD_ATTORNEY",
  "ASSOCIATE_ATTORNEY",
  "PARALEGAL",
  "STAFF",
] as const satisfies readonly AssignmentRole[];

const cuid = z.string().min(1, "Required.");

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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

// --- Matters -------------------------------------------------------------
//
// Creating or editing a Matter's own fields (as opposed to its
// sub-resources above) is gated by `canManageClientsAndMatters` — see
// lib/auth/authorization.ts for why this is a separate, more conservative
// rule than the matter-assignment check every action above uses.

const assignmentInputSchema = z
  .array(
    z.object({
      userId: cuid,
      role: z.enum(ASSIGNMENT_ROLE_VALUES),
    }),
  )
  .min(1, "At least one staff assignment is required.")
  .refine(
    (rows) => new Set(rows.map((r) => r.userId)).size === rows.length,
    "The same staff member was selected more than once.",
  );

const createMatterSchema = z.object({
  clientId: cuid,
  caseNumber: z.string().trim().min(1, "Case number is required.").max(50, "Case number is too long."),
  court: z.string().trim().min(1, "Court is required.").max(200, "Court is too long."),
  charges: z.string().trim().min(1, "Charges are required.").max(500, "Charges description is too long."),
  status: z.enum(MATTER_STATUS_VALUES).default("OPEN"),
  openedDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid opened date."),
  closedDate: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Invalid closed date."),
  assignments: assignmentInputSchema,
});

function readAssignmentRows(formData: FormData) {
  const userIds = formData.getAll("assignmentUserId").map(String);
  const roles = formData.getAll("assignmentRole").map(String);
  return userIds.map((userId, i) => ({ userId, role: roles[i] ?? "" })).filter((row) => row.userId);
}

export async function createMatter(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!canManageClientsAndMatters(user)) {
    return { error: NOT_FOUND.error };
  }

  const parsed = createMatterSchema.safeParse({
    clientId: formData.get("clientId"),
    caseNumber: formData.get("caseNumber"),
    court: formData.get("court"),
    charges: formData.get("charges"),
    status: formData.get("status") || "OPEN",
    openedDate: formData.get("openedDate"),
    closedDate: formData.get("closedDate") ?? undefined,
    assignments: readAssignmentRows(formData),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { clientId, caseNumber, court, charges, status, openedDate, closedDate, assignments } = parsed.data;

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) {
    return { error: "Selected client not found." };
  }

  const assignedUserIds = [...new Set(assignments.map((a) => a.userId))];
  const validUsers = await prisma.user.findMany({
    where: { id: { in: assignedUserIds }, active: true },
    select: { id: true },
  });
  if (validUsers.length !== assignedUserIds.length) {
    return { error: "One or more selected staff members are invalid." };
  }

  let matter;
  try {
    matter = await prisma.matter.create({
      data: {
        clientId,
        caseNumber,
        court,
        charges,
        status,
        openedDate: new Date(openedDate),
        closedDate: closedDate ? new Date(closedDate) : undefined,
        assignments: { create: assignments.map((a) => ({ userId: a.userId, role: a.role })) },
      },
      include: { assignments: true },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { error: "A matter with this case number already exists." };
    }
    console.error("[createMatter] failed", error);
    return { error: "Failed to create matter." };
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "Matter",
      entityId: matter.id,
      matterId: matter.id,
      metadata: { caseNumber, clientId },
    },
  });
  for (const assignment of matter.assignments) {
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "CREATE",
        entityType: "MatterAssignment",
        entityId: assignment.id,
        matterId: matter.id,
        metadata: { userId: assignment.userId, role: assignment.role },
      },
    });
  }

  revalidatePath("/matters");
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/");
  redirect(`/matters/${matter.id}`);
}

const updateMatterSchema = z.object({
  matterId: cuid,
  caseNumber: z.string().trim().min(1, "Case number is required.").max(50, "Case number is too long."),
  court: z.string().trim().min(1, "Court is required.").max(200, "Court is too long."),
  charges: z.string().trim().min(1, "Charges are required.").max(500, "Charges description is too long."),
  status: z.enum(MATTER_STATUS_VALUES),
  openedDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid opened date."),
  closedDate: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Invalid closed date."),
});

export async function updateMatter(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const parsed = updateMatterSchema.safeParse({
    matterId: formData.get("matterId"),
    caseNumber: formData.get("caseNumber"),
    court: formData.get("court"),
    charges: formData.get("charges"),
    status: formData.get("status"),
    openedDate: formData.get("openedDate"),
    closedDate: formData.get("closedDate") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, caseNumber, court, charges, status, openedDate, closedDate } = parsed.data;

  // Scoped by matterId, not just role: an ATTORNEY who isn't assigned to
  // this particular matter is denied exactly like a nonexistent matter id
  // (see lib/auth/access.ts#canEditMatter) — a submitted id can't be used
  // to reach a matter outside the caller's own assignments.
  if (!(await canEditMatter(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  const before = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { caseNumber: true, court: true, charges: true, status: true, openedDate: true, closedDate: true },
  });
  if (!before) {
    return { error: NOT_FOUND.error };
  }

  const nextClosedDate = closedDate ? new Date(closedDate) : null;
  try {
    await prisma.matter.update({
      where: { id: matterId },
      data: {
        caseNumber,
        court,
        charges,
        status,
        openedDate: new Date(openedDate),
        closedDate: nextClosedDate,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { error: "A matter with this case number already exists." };
    }
    console.error("[updateMatter] failed", error);
    return { error: "Failed to update matter." };
  }

  const changed = diffFields(before, {
    caseNumber,
    court,
    charges,
    status,
    openedDate: new Date(openedDate),
    closedDate: nextClosedDate,
  });

  if (Object.keys(changed).length > 0) {
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Matter",
        entityId: matterId,
        matterId,
        metadata: { changed },
      },
    });
  }

  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/edit`);
  revalidatePath(`/matters/${matterId}/timeline`);
  revalidatePath("/matters");
  revalidatePath("/");
  redirect(`/matters/${matterId}`);
}

// --- Matter assignments ----------------------------------------------------

const addAssignmentSchema = z.object({
  matterId: cuid,
  userId: cuid,
  role: z.enum(ASSIGNMENT_ROLE_VALUES),
});

/** Called directly from the Edit Matter page's "Add assignment" control, not a <form>. */
export async function addMatterAssignment(input: {
  matterId: string;
  userId: string;
  role: AssignmentRole;
}): Promise<ActionResult> {
  const user = await requireCurrentUser();

  const parsed = addAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, userId, role } = parsed.data;

  if (!(await canEditMatter(user, matterId))) {
    return NOT_FOUND;
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { active: true } });
  if (!targetUser || !targetUser.active) {
    return { ok: false, error: "Selected staff member is invalid." };
  }

  let assignment;
  try {
    assignment = await prisma.matterAssignment.create({ data: { matterId, userId, role } });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: false, error: "That staff member is already assigned to this matter." };
    }
    console.error("[addMatterAssignment] failed", error);
    return { ok: false, error: "Failed to add assignment." };
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "MatterAssignment",
      entityId: assignment.id,
      matterId,
      metadata: { userId, role },
    },
  });

  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/edit`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { ok: true, data: undefined };
}

const removeAssignmentSchema = z.object({
  matterId: cuid,
  assignmentId: cuid,
});

/** Called directly from the Edit Matter page's "Remove" control, not a <form>. */
export async function removeMatterAssignment(input: {
  matterId: string;
  assignmentId: string;
}): Promise<ActionResult> {
  const user = await requireCurrentUser();

  const parsed = removeAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, assignmentId } = parsed.data;

  if (!(await canEditMatter(user, matterId))) {
    return NOT_FOUND;
  }

  // Scoped by matterId, exactly like updateTaskStatus/attachCallToMatter
  // above: an assignment id from a different matter can never be deleted
  // via this matter's edit page, even by a caller who can edit *some*
  // matter.
  const result = await prisma.matterAssignment.deleteMany({ where: { id: assignmentId, matterId } });
  if (result.count === 0) {
    return NOT_FOUND;
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "DELETE",
      entityType: "MatterAssignment",
      entityId: assignmentId,
      matterId,
    },
  });

  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/edit`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { ok: true, data: undefined };
}
