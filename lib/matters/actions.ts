"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type {
  AssignmentRole,
  CalendarEventType,
  CallDirection,
  DeadlineType,
  MatterStatus,
  TaskPriority,
  TaskStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { canEditMatter, canManageMatterTeam, hasMatterAccess } from "@/lib/auth/access";
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
const DEADLINE_TYPE_VALUES = [
  "STATUTE_OF_LIMITATIONS",
  "SPEEDY_TRIAL",
  "FILING",
  "OTHER",
] as const satisfies readonly DeadlineType[];
const CALENDAR_EVENT_TYPE_VALUES = [
  "HEARING",
  "DEPOSITION",
  "MEETING",
  "OTHER",
] as const satisfies readonly CalendarEventType[];
const CALL_DIRECTION_VALUES = ["INBOUND", "OUTBOUND"] as const satisfies readonly CallDirection[];

const cuid = z.string().min(1, "Required.");

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * `hasMatterAccess` returns `true` for ADMIN unconditionally, without
 * checking the matter actually exists (admins bypass the assignment check
 * entirely — see lib/auth/authorization.ts#isAdmin). For every write path
 * below that creates a *new* row referencing `matterId` as a foreign key
 * (rather than looking up an existing row scoped by it, which would
 * already fail gracefully for a nonexistent matter), a forged/nonexistent
 * `matterId` from an ADMIN session reaches Postgres and fails the FK
 * constraint. Caught here so that surfaces as the same generic
 * "not found" every other denial gives, not an unhandled DB error.
 */
function isForeignKeyConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
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

  let note;
  try {
    note = await prisma.note.create({
      data: { matterId, authorId: user.id, body },
    });
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      return { error: NOT_FOUND.error };
    }
    throw error;
  }

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

const updateNoteSchema = z.object({
  matterId: cuid,
  noteId: cuid,
  body: z.string().trim().min(1, "Note text is required.").max(10_000, "Note is too long."),
  pinned: z.boolean(),
});

export async function updateNote(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const parsed = updateNoteSchema.safeParse({
    matterId: formData.get("matterId"),
    noteId: formData.get("noteId"),
    body: formData.get("body"),
    pinned: formData.get("pinned") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, noteId, body, pinned } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  // Scoped by matterId, not just id: a noteId from a different matter can
  // never be edited through this matter, even by a caller who has
  // legitimate write access to *some* matter. Author/createdAt are never
  // touched by this action — only body and pinned change.
  const before = await prisma.note.findFirst({
    where: { id: noteId, matterId },
    select: { body: true, pinned: true },
  });
  if (!before) {
    return { error: NOT_FOUND.error };
  }

  await prisma.note.update({
    where: { id: noteId },
    data: { body, pinned },
  });

  // `body` is the note's actual content — never dump the before/after text
  // into the audit log (see docs/SECURITY.md); record only that it
  // changed, same treatment `Client.notes`/`Document.notes` already get.
  const bodyChanged = before.body !== body;
  const changed = diffFields({ pinned: before.pinned }, { pinned });

  if (bodyChanged || Object.keys(changed).length > 0) {
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Note",
        entityId: noteId,
        matterId,
        metadata: {
          ...(bodyChanged ? { contentChanged: true } : {}),
          ...(Object.keys(changed).length > 0 ? { changed } : {}),
        },
      },
    });
  }

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

  let task;
  try {
    task = await prisma.task.create({
      data: {
        matterId,
        title,
        description,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        priority,
      },
    });
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      return { error: NOT_FOUND.error };
    }
    throw error;
  }

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

const updateTaskSchema = z.object({
  matterId: cuid,
  taskId: cuid,
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
  priority: z.enum(TASK_PRIORITY_VALUES),
  status: z.enum(TASK_STATUS_VALUES),
  assignedToId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/**
 * Full edit form for a Task (title/description/due date/priority/status/
 * assignee). Writes the same `status` column `updateTaskStatus` (Kanban
 * drag-and-drop) does, so the two stay consistent by construction — both
 * are just ordinary writes to `Task.status`, and either one's
 * `revalidatePath` refreshes the same Tasks page the other renders from.
 */
export async function updateTask(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const parsed = updateTaskSchema.safeParse({
    matterId: formData.get("matterId"),
    taskId: formData.get("taskId"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    dueDate: formData.get("dueDate") ?? undefined,
    priority: formData.get("priority"),
    status: formData.get("status"),
    assignedToId: formData.get("assignedToId") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, taskId, title, description, dueDate, priority, status, assignedToId } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  // Scoped by matterId, not just id: a taskId from a different matter can
  // never be edited through this matter, even by a caller who has
  // legitimate write access to *some* matter.
  const before = await prisma.task.findFirst({
    where: { id: taskId, matterId },
    select: {
      title: true,
      description: true,
      dueDate: true,
      priority: true,
      status: true,
      assignedToId: true,
    },
  });
  if (!before) {
    return { error: NOT_FOUND.error };
  }

  // An assignee must be an active user who has a legitimate reason to
  // know this matter exists — either genuinely assigned to it, or an
  // ADMIN (who can see every matter). This reuses `hasMatterAccess`
  // as-is against the *candidate* assignee's own id/role rather than the
  // caller's, so a forged assignedToId naming some unrelated active user
  // can never be assigned to a matter they have no access to, even though
  // the id itself is a real, active user. No new authorization concept —
  // exactly the same rule that already gates who may view this matter.
  if (assignedToId) {
    const candidate = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true, role: true, status: true },
    });
    if (!candidate || candidate.status !== "ACTIVE") {
      return { error: "Selected assignee is invalid." };
    }
    if (!(await hasMatterAccess(candidate, matterId))) {
      return { error: "Selected assignee does not have access to this matter." };
    }
  }

  const nextDueDate = dueDate ? new Date(dueDate) : null;
  const nextAssignedToId = assignedToId ?? null;
  const nextDescription = description ?? null;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      title,
      description: nextDescription,
      dueDate: nextDueDate,
      priority,
      status,
      assignedToId: nextAssignedToId,
    },
  });

  // `description` is free text (up to 2,000 chars) and can carry the same
  // kind of case-sensitive detail as a Note — record only that it
  // changed, never the content, same treatment `Note.body`/`Client.notes`/
  // `Document.notes` already get (see docs/SECURITY.md).
  const descriptionChanged = before.description !== nextDescription;
  const changed = diffFields(
    {
      title: before.title,
      dueDate: before.dueDate,
      priority: before.priority,
      status: before.status,
      assignedToId: before.assignedToId,
    },
    { title, dueDate: nextDueDate, priority, status, assignedToId: nextAssignedToId },
  );

  if (descriptionChanged || Object.keys(changed).length > 0) {
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Task",
        entityId: taskId,
        matterId,
        metadata: {
          ...(Object.keys(changed).length > 0 ? { changed } : {}),
          ...(descriptionChanged ? { descriptionChanged: true } : {}),
        },
      },
    });
  }

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
//
// `createCall` is the first real write path for logging a brand-new Call
// (as opposed to `attachCallToMatter` below, which only ever files an
// already-existing unfiled row — see docs/ROADMAP.md). No Vonage/telephony
// integration exists yet; every Call created here is manually logged by a
// staff member, using exactly the fields already on `Call` (see
// docs/DATA_MODEL.md) so a future Vonage sync can feed the same model
// without changing this action's shape.

const phoneNumberSchema = z
  .string()
  .trim()
  .min(7, "Enter a valid phone number.")
  .max(20, "Phone number is too long.")
  .regex(/^[0-9+().\-\s]+$/, "Enter a valid phone number.");

const createCallSchema = z.object({
  // No matter-management role gate here, unlike Client/Matter creation —
  // logging a call is the same "any staff member on the phone" action
  // Notes/Tasks/Calls already treat as available to every assigned role
  // (see docs/SECURITY.md). A submitted matterId is still independently
  // verified below via `hasMatterAccess` — never trusted from the form.
  matterId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  direction: z.enum(CALL_DIRECTION_VALUES),
  contactName: z
    .string()
    .trim()
    .max(200, "Contact name is too long.")
    .optional()
    .transform((v) => (v ? v : undefined)),
  fromNumber: phoneNumberSchema,
  toNumber: phoneNumberSchema,
  occurredAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date/time."),
  durationSeconds: z.coerce
    .number()
    .int("Duration must be a whole number of seconds.")
    .min(0, "Duration cannot be negative.")
    .max(24 * 60 * 60, "Duration is too long."),
  notes: z
    .string()
    .trim()
    .max(4_000, "Notes are too long.")
    .optional()
    .transform((v) => (v ? v : undefined)),
  flagged: z.boolean(),
});

/**
 * Logs a brand-new Call. If `matterId` is supplied and the caller has
 * access to it, the call is created already filed to that matter
 * (`filedById`/`filedAt` set, same meaning `attachCallToMatter` gives
 * those columns) — otherwise it's created unfiled, exactly like a call
 * a future Vonage sync would drop into the unfiled pool for later review.
 * A `matterId` the caller can't access fails with the same generic error
 * as every other write action, rather than silently dropping it and
 * creating an unfiled call instead — the caller asked to file it, and
 * silently not doing that would hide a real authorization denial.
 */
export async function createCall(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const parsed = createCallSchema.safeParse({
    matterId: formData.get("matterId") ?? undefined,
    direction: formData.get("direction"),
    contactName: formData.get("contactName") ?? undefined,
    fromNumber: formData.get("fromNumber"),
    toNumber: formData.get("toNumber"),
    occurredAt: formData.get("occurredAt"),
    durationSeconds: formData.get("durationSeconds"),
    notes: formData.get("notes") ?? undefined,
    flagged: formData.get("flagged") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, direction, contactName, fromNumber, toNumber, occurredAt, durationSeconds, notes, flagged } =
    parsed.data;

  if (matterId && !(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  const filed = Boolean(matterId);
  let call;
  try {
    call = await prisma.call.create({
      data: {
        matterId: matterId ?? null,
        contactName: contactName ?? null,
        direction,
        fromNumber,
        toNumber,
        occurredAt: new Date(occurredAt),
        durationSeconds,
        notes: notes ?? null,
        flagged,
        filedById: filed ? user.id : null,
        filedAt: filed ? new Date() : null,
      },
    });
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      return { error: NOT_FOUND.error };
    }
    throw error;
  }

  // Minimal, non-sensitive metadata only — never the notes text itself
  // (same restraint `Note.body`/`Task.description`/`Client.notes` already
  // get, see docs/SECURITY.md's audit logging guidance) and never the raw
  // phone numbers either, since those alone can identify a client or
  // witness even without a matter attached.
  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "Call",
      entityId: call.id,
      matterId: matterId ?? null,
      metadata: { direction, filed, flagged, notesProvided: Boolean(notes) },
    },
  });

  if (matterId) {
    revalidatePath(`/matters/${matterId}/calls`);
    revalidatePath(`/matters/${matterId}`);
    revalidatePath(`/matters/${matterId}/timeline`);
  }
  revalidatePath("/communications");
  revalidatePath("/");
  return { ...FORM_OK };
}

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

  // Unfiled calls are only ever visible to ADMIN/ATTORNEY (see
  // lib/communications/queries.ts#getCallVisibilityFilter) — a PARALEGAL/
  // STAFF caller can't legitimately know an unfiled `callId` exists, so
  // this mirrors that same gate rather than relying on `hasMatterAccess`
  // alone, which only confirms they can see the *destination* matter.
  if (!canManageClientsAndMatters(user)) {
    return NOT_FOUND;
  }

  if (!(await hasMatterAccess(user, matterId))) {
    return NOT_FOUND;
  }

  // Only ever attach a call that is still unfiled — never re-parent a call
  // that's already on another matter, and never leak whether `callId`
  // belongs to someone else's matter vs. not existing at all.
  let result;
  try {
    result = await prisma.call.updateMany({
      where: { id: callId, matterId: null },
      data: { matterId, filedById: user.id, filedAt: new Date() },
    });
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      return NOT_FOUND;
    }
    throw error;
  }
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
// A Matter's own fields (as opposed to its sub-resources above) are gated
// more conservatively than the plain matter-assignment check every action
// above uses: `createMatter` requires `canManageClientsAndMatters` (no
// existing matter to be assigned to yet — see lib/auth/authorization.ts),
// and `updateMatter`/`archiveMatter`/`reactivateMatter`/assignment-roster
// edits below require `canEditMatter`, which layers matter-assignment on
// top of that same role check (see lib/auth/access.ts#canEditMatter) so an
// ATTORNEY can't edit a matter they aren't actually assigned to.

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

const createMatterSchema = z
  .object({
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
  })
  .refine((data) => !data.closedDate || new Date(data.closedDate) >= new Date(data.openedDate), {
    message: "Closed date can't be before the opened date.",
    path: ["closedDate"],
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
    where: { id: { in: assignedUserIds }, status: "ACTIVE" },
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

const updateMatterSchema = z
  .object({
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
  })
  .refine((data) => !data.closedDate || new Date(data.closedDate) >= new Date(data.openedDate), {
    message: "Closed date can't be before the opened date.",
    path: ["closedDate"],
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

// --- Archive / reactivate ---------------------------------------------------
//
// Reversible removal from default active lists/pickers (see
// Matter.archived in prisma/schema.prisma) — a pure visibility flag, never
// a delete and never a case-outcome change: `status`/`closedDate` and
// every associated Note/Task/Deadline/Document/Discovery/Call/
// MatterAssignment/AuditEvent are left completely untouched either way.
// Existing matter-level authorization (`assertMatterAccess`,
// `matterIdFilterFor`/`matterScopeFilterFor`) is unaffected too — archiving
// only changes whether a Matter shows up in the *default* list/picker view,
// never who may directly access it (see docs/SECURITY.md).
//
// Gated by the same rule `updateMatter` above already uses for editing a
// Matter's own fields — no new permission is invented: ADMIN, or an
// ATTORNEY actually assigned to this specific matter
// (lib/auth/access.ts#canEditMatter). PARALEGAL/STAFF can never archive or
// reactivate a Matter, same as they can never edit one.

const archiveMatterSchema = z.object({ matterId: cuid });

export async function archiveMatter(input: { matterId: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();

  const parsed = archiveMatterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId } = parsed.data;

  // Scoped by matterId, not just role (see updateMatter above) — an
  // ATTORNEY who isn't assigned to this particular matter, or a forged id
  // for a matter outside the caller's access, gets the same generic
  // not-found response as a nonexistent matter.
  if (!(await canEditMatter(user, matterId))) {
    return NOT_FOUND;
  }

  const matter = await prisma.matter.findUnique({ where: { id: matterId }, select: { archived: true } });
  if (!matter) {
    return NOT_FOUND;
  }
  if (matter.archived) {
    return { ok: false, error: "This matter is already archived." };
  }

  await prisma.matter.update({
    where: { id: matterId },
    data: { archived: true, archivedAt: new Date(), archivedById: user.id },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "UPDATE",
      entityType: "Matter",
      entityId: matterId,
      matterId,
      metadata: { archived: true },
    },
  });

  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/edit`);
  revalidatePath("/matters");
  revalidatePath("/");
  return { ok: true, data: undefined };
}

export async function reactivateMatter(input: { matterId: string }): Promise<ActionResult> {
  const user = await requireCurrentUser();

  const parsed = archiveMatterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId } = parsed.data;

  if (!(await canEditMatter(user, matterId))) {
    return NOT_FOUND;
  }

  const matter = await prisma.matter.findUnique({ where: { id: matterId }, select: { archived: true } });
  if (!matter) {
    return NOT_FOUND;
  }
  if (!matter.archived) {
    return { ok: false, error: "This matter is not archived." };
  }

  await prisma.matter.update({
    where: { id: matterId },
    data: { archived: false, archivedAt: null, archivedById: null },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "UPDATE",
      entityType: "Matter",
      entityId: matterId,
      matterId,
      metadata: { archived: false },
    },
  });

  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/edit`);
  revalidatePath("/matters");
  revalidatePath("/");
  return { ok: true, data: undefined };
}

// --- Matter assignments ----------------------------------------------------

const addAssignmentSchema = z.object({
  matterId: cuid,
  userId: cuid,
  role: z.enum(ASSIGNMENT_ROLE_VALUES),
});

/**
 * Called directly from the Edit Matter page's "Add assignment" control,
 * not a <form>. Gated by `canManageMatterTeam` — the matter's own
 * LEAD_ATTORNEY, or an ADMIN — deliberately narrower than `canEditMatter`
 * (which also allows an ASSOCIATE_ATTORNEY to edit case-detail fields but
 * must not be able to reshape who's on the team).
 *
 * Adding a second `LEAD_ATTORNEY` doesn't create two leads: the matter's
 * existing lead assignment (if any) is atomically demoted to
 * `ASSOCIATE_ATTORNEY` in the same transaction — this is how "change the
 * lead attorney" works, through the same Add control, without inventing a
 * separate UI just to swap that one role.
 */
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

  if (!(await canManageMatterTeam(user, matterId))) {
    return NOT_FOUND;
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!targetUser || targetUser.status !== "ACTIVE") {
    return { ok: false, error: "Selected staff member is invalid." };
  }

  let assignment;
  let previousLeadUserId: string | null = null;
  try {
    if (role === "LEAD_ATTORNEY") {
      const existingLead = await prisma.matterAssignment.findFirst({
        where: { matterId, role: "LEAD_ATTORNEY" },
      });
      if (existingLead) {
        const [, created] = await prisma.$transaction([
          prisma.matterAssignment.update({ where: { id: existingLead.id }, data: { role: "ASSOCIATE_ATTORNEY" } }),
          prisma.matterAssignment.create({ data: { matterId, userId, role } }),
        ]);
        assignment = created;
        previousLeadUserId = existingLead.userId;
      } else {
        assignment = await prisma.matterAssignment.create({ data: { matterId, userId, role } });
      }
    } else {
      assignment = await prisma.matterAssignment.create({ data: { matterId, userId, role } });
    }
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
      metadata: { userId, role, ...(previousLeadUserId ? { leadAttorneyChanged: true, previousLeadUserId } : {}) },
    },
  });
  if (previousLeadUserId) {
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "MatterAssignment",
        entityId: previousLeadUserId,
        matterId,
        metadata: { field: "role", from: "LEAD_ATTORNEY", to: "ASSOCIATE_ATTORNEY", userId: previousLeadUserId },
      },
    });
  }

  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/edit`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { ok: true, data: undefined };
}

const removeAssignmentSchema = z.object({
  matterId: cuid,
  assignmentId: cuid,
});

/** Called directly from the Edit Matter page's "Remove" control, not a <form>. Gated by `canManageMatterTeam` — see `addMatterAssignment` above. */
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

  if (!(await canManageMatterTeam(user, matterId))) {
    return NOT_FOUND;
  }

  // Mirrors createMatterSchema's "at least one staff assignment is
  // required" (see above) on the removal side — the edit page's UI
  // already disables "Remove" on the last row, but a Server Action is
  // directly invokable, and removing the only assignment would make the
  // matter permanently inaccessible to every non-admin, including whoever
  // just removed it, with no admin-assisted way back in short of another
  // admin re-adding it.
  const assignmentCount = await prisma.matterAssignment.count({ where: { matterId } });
  if (assignmentCount <= 1) {
    return { ok: false, error: "A matter must always have at least one staff assignment." };
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

// --- Deadlines ---------------------------------------------------------
//
// Deadline has no docs/DATA_MODEL.md-stricter access rule of its own, so
// per this pass's explicit fallback, it uses the same matter-access rule
// as Notes/Tasks/Calls above (any assigned role, not just ADMIN/ATTORNEY —
// unlike the Client/Matter management rule in the milestone above, which
// only applies to originating a brand-new case record). Neither
// `Deadline` nor `CalendarEvent` has an assignee/attendee column in
// `prisma/schema.prisma`, so there's no user id to validate here.

const deadlineFieldsSchema = z.object({
  type: z.enum(DEADLINE_TYPE_VALUES),
  date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date."),
  description: z.string().trim().min(1, "Description is required.").max(1_000, "Description is too long."),
  reminderDaysBefore: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 7))
    .refine((v) => Number.isInteger(v) && v >= 0 && v <= 365, "Reminder days must be between 0 and 365."),
});

function readDeadlineFields(formData: FormData) {
  return deadlineFieldsSchema.safeParse({
    type: formData.get("type"),
    date: formData.get("date"),
    description: formData.get("description"),
    reminderDaysBefore: formData.get("reminderDaysBefore") ?? undefined,
  });
}

export async function createDeadline(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) {
    return { error: NOT_FOUND.error };
  }
  const parsed = readDeadlineFields(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { type, date, description, reminderDaysBefore } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  let deadline;
  try {
    deadline = await prisma.deadline.create({
      data: { matterId, type, date: new Date(date), description, reminderDaysBefore },
    });
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      return { error: NOT_FOUND.error };
    }
    throw error;
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "Deadline",
      entityId: deadline.id,
      matterId,
      metadata: { type, date },
    },
  });

  revalidatePath(`/matters/${matterId}/deadlines`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  revalidatePath("/");
  return { ...FORM_OK };
}

export async function updateDeadline(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const matterId = String(formData.get("matterId") ?? "");
  const deadlineId = String(formData.get("deadlineId") ?? "");
  if (!matterId || !deadlineId) {
    return { error: NOT_FOUND.error };
  }
  const parsed = readDeadlineFields(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { type, date, description, reminderDaysBefore } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  // Scoped by matterId, not just id: a deadlineId from a different matter
  // can never be edited through this matter, even by a caller who has
  // legitimate write access to *some* matter.
  const before = await prisma.deadline.findFirst({
    where: { id: deadlineId, matterId },
    select: { type: true, date: true, description: true, reminderDaysBefore: true },
  });
  if (!before) {
    return { error: NOT_FOUND.error };
  }

  const nextDate = new Date(date);
  await prisma.deadline.update({
    where: { id: deadlineId },
    data: { type, date: nextDate, description, reminderDaysBefore },
  });

  const changed = diffFields(before, { type, date: nextDate, description, reminderDaysBefore });
  if (Object.keys(changed).length > 0) {
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Deadline",
        entityId: deadlineId,
        matterId,
        metadata: { changed },
      },
    });
  }

  revalidatePath(`/matters/${matterId}/deadlines`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  revalidatePath("/");
  return { ...FORM_OK };
}

const setDeadlineSatisfiedSchema = z.object({
  matterId: cuid,
  deadlineId: cuid,
  satisfied: z.boolean(),
});

/** Called directly from the Deadlines tab's complete/incomplete toggle, not a <form>. */
export async function setDeadlineSatisfied(input: {
  matterId: string;
  deadlineId: string;
  satisfied: boolean;
}): Promise<ActionResult> {
  const user = await requireCurrentUser();

  const parsed = setDeadlineSatisfiedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, deadlineId, satisfied } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return NOT_FOUND;
  }

  const result = await prisma.deadline.updateMany({
    where: { id: deadlineId, matterId },
    data: { satisfied, satisfiedAt: satisfied ? new Date() : null },
  });
  if (result.count === 0) {
    return NOT_FOUND;
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "UPDATE",
      entityType: "Deadline",
      entityId: deadlineId,
      matterId,
      metadata: { satisfied },
    },
  });

  revalidatePath(`/matters/${matterId}/deadlines`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  revalidatePath("/");
  return { ok: true, data: undefined };
}

// --- Calendar events -----------------------------------------------------
//
// Same matter-access rule as Deadlines above — no attendee/assignee field
// exists on CalendarEvent to validate.

const calendarEventFieldsSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
    type: z.enum(CALENDAR_EVENT_TYPE_VALUES),
    startTime: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid start time."),
    endTime: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Invalid end time."),
    location: z
      .string()
      .trim()
      .max(300, "Location is too long.")
      .optional()
      .transform((v) => (v ? v : undefined)),
    notes: z
      .string()
      .trim()
      .max(2_000, "Notes are too long.")
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine(
    (data) => !data.endTime || new Date(data.endTime) > new Date(data.startTime),
    { message: "End time must be after start time.", path: ["endTime"] },
  );

function readCalendarEventFields(formData: FormData) {
  return calendarEventFieldsSchema.safeParse({
    title: formData.get("title"),
    type: formData.get("type"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime") ?? undefined,
    location: formData.get("location") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });
}

export async function createCalendarEvent(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) {
    return { error: NOT_FOUND.error };
  }
  const parsed = readCalendarEventFields(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { title, type, startTime, endTime, location, notes } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  let event;
  try {
    event = await prisma.calendarEvent.create({
      data: {
        matterId,
        title,
        type,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : undefined,
        location,
        notes,
      },
    });
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      return { error: NOT_FOUND.error };
    }
    throw error;
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "CalendarEvent",
      entityId: event.id,
      matterId,
      metadata: { type, startTime },
    },
  });

  revalidatePath(`/matters/${matterId}/deadlines`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  revalidatePath("/");
  return { ...FORM_OK };
}

export async function updateCalendarEvent(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const matterId = String(formData.get("matterId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  if (!matterId || !eventId) {
    return { error: NOT_FOUND.error };
  }
  const parsed = readCalendarEventFields(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { title, type, startTime, endTime, location, notes } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  // Scoped by matterId, same as updateDeadline above.
  const before = await prisma.calendarEvent.findFirst({
    where: { id: eventId, matterId },
    select: { title: true, type: true, startTime: true, endTime: true, location: true, notes: true },
  });
  if (!before) {
    return { error: NOT_FOUND.error };
  }

  const nextStartTime = new Date(startTime);
  const nextEndTime = endTime ? new Date(endTime) : null;
  await prisma.calendarEvent.update({
    where: { id: eventId },
    data: {
      title,
      type,
      startTime: nextStartTime,
      endTime: nextEndTime,
      location: location ?? null,
      notes: notes ?? null,
    },
  });

  // `location`/`notes` are free text (a full address, or anything a staff
  // member typed) — never dump their before/after values into the audit
  // log (see docs/SECURITY.md), same treatment Note.body/Document.notes
  // already get. Record only that they changed.
  const locationChanged = (before.location ?? null) !== (location ?? null);
  const notesChanged = (before.notes ?? null) !== (notes ?? null);
  const changed = diffFields(
    { title: before.title, type: before.type, startTime: before.startTime, endTime: before.endTime },
    { title, type, startTime: nextStartTime, endTime: nextEndTime },
  );
  if (Object.keys(changed).length > 0 || locationChanged || notesChanged) {
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "CalendarEvent",
        entityId: eventId,
        matterId,
        metadata: { changed, locationChanged, notesChanged },
      },
    });
  }

  revalidatePath(`/matters/${matterId}/deadlines`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  revalidatePath("/");
  return { ...FORM_OK };
}
