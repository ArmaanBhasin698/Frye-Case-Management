import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/** A real PrismaClientKnownRequestError instance, for exercising the isForeignKeyConstraintError/isUniqueConstraintError catch paths. */
function fakePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Simulated ${code}`, { code, clientVersion: "test" });
}

const { requireCurrentUserMock, hasMatterAccessMock, canEditMatterMock, prismaMock, revalidatePathMock, redirectMock } =
  vi.hoisted(() => ({
    requireCurrentUserMock: vi.fn(),
    hasMatterAccessMock: vi.fn(),
    canEditMatterMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    redirectMock: vi.fn(() => {
      throw new Error("NEXT_REDIRECT");
    }),
    prismaMock: {
      note: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      task: { create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      call: { updateMany: vi.fn(), create: vi.fn() },
      client: { findUnique: vi.fn() },
      user: { findMany: vi.fn(), findUnique: vi.fn() },
      matter: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
      matterAssignment: { create: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
      deadline: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
      calendarEvent: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
      auditEvent: { create: vi.fn() },
    },
  }));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({
  hasMatterAccess: hasMatterAccessMock,
  canEditMatter: canEditMatterMock,
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const {
  addMatterAssignment,
  archiveMatter,
  attachCallToMatter,
  createCalendarEvent,
  createCall,
  createDeadline,
  createMatter,
  createNote,
  createTask,
  reactivateMatter,
  removeMatterAssignment,
  setDeadlineSatisfied,
  updateCalendarEvent,
  updateDeadline,
  updateMatter,
  updateNote,
  updateTask,
  updateTaskStatus,
} = await import("@/lib/matters/actions");

const user = { id: "user-1", role: "STAFF" as const };
const attorney = { id: "user-2", role: "ATTORNEY" as const };
const admin = { id: "user-admin", role: "ADMIN" as const };
const matterId = "matter-1";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(user);
  hasMatterAccessMock.mockResolvedValue(true);
  canEditMatterMock.mockResolvedValue(true);
  redirectMock.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("createNote", () => {
  it("rejects an empty body before touching the database", async () => {
    const result = await createNote({ error: null }, formData({ matterId, body: "   " }));
    expect(result?.error).toBeTruthy();
    expect(prismaMock.note.create).not.toHaveBeenCalled();
  });

  it("returns a generic error and writes nothing when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await createNote({ error: null }, formData({ matterId, body: "Client called." }));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.note.create).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("creates the note and an audit event for an authorized user", async () => {
    prismaMock.note.create.mockResolvedValue({ id: "note-1" });
    const result = await createNote({ error: null }, formData({ matterId, body: "Client called." }));
    expect(result.error).toBeNull();
    expect(prismaMock.note.create).toHaveBeenCalledWith({
      data: { matterId, authorId: user.id, body: "Client called." },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: { actorId: user.id, action: "CREATE", entityType: "Note", entityId: "note-1", matterId },
    });
  });

  it("returns a generic not-found instead of throwing when matterId is a forged/nonexistent id (e.g. an ADMIN whose hasMatterAccess bypasses the assignment check)", async () => {
    prismaMock.note.create.mockRejectedValue(fakePrismaError("P2003"));
    const result = await createNote({ error: null }, formData({ matterId, body: "Client called." }));
    expect(result?.error).toBe("Not found or access denied.");
  });
});

describe("updateNote", () => {
  const noteId = "note-1";
  const validFields = { matterId, noteId, body: "Client confirmed the amended timeline." };

  beforeEach(() => {
    prismaMock.note.findFirst.mockResolvedValue({ body: "Original note text.", pinned: false });
  });

  it("rejects an empty body before touching the database", async () => {
    const result = await updateNote({ error: null }, formData({ ...validFields, body: "   " }));
    expect(result?.error).toBeTruthy();
    expect(prismaMock.note.update).not.toHaveBeenCalled();
  });

  it("denies the edit when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await updateNote({ error: null }, formData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.note.update).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the given matter, denying a cross-matter note id", async () => {
    prismaMock.note.findFirst.mockResolvedValue(null);
    const result = await updateNote({ error: null }, formData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.note.findFirst).toHaveBeenCalledWith({
      where: { id: noteId, matterId },
      select: { body: true, pinned: true },
    });
    expect(prismaMock.note.update).not.toHaveBeenCalled();
  });

  it("updates the note body/pinned and preserves author/createdAt (never touched)", async () => {
    prismaMock.note.update.mockResolvedValue({});
    const result = await updateNote({ error: null }, formData({ ...validFields, pinned: "on" }));
    expect(result.error).toBeNull();
    expect(prismaMock.note.update).toHaveBeenCalledWith({
      where: { id: noteId },
      data: { body: "Client confirmed the amended timeline.", pinned: true },
    });
  });

  it("records only that the note content changed, never the before/after text, in the audit event", async () => {
    prismaMock.note.update.mockResolvedValue({});
    await updateNote({ error: null }, formData(validFields));
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UPDATE",
        entityType: "Note",
        entityId: noteId,
        matterId,
        metadata: { contentChanged: true },
      }),
    });
    const call = prismaMock.auditEvent.create.mock.calls.at(0)?.[0];
    expect(JSON.stringify(call)).not.toContain("Original note text.");
    expect(JSON.stringify(call)).not.toContain("Client confirmed the amended timeline.");
  });

  it("records a pinned change via the normal before/after diff (not sensitive content)", async () => {
    prismaMock.note.findFirst.mockResolvedValue({ body: "Original note text.", pinned: false });
    prismaMock.note.update.mockResolvedValue({});
    await updateNote(
      { error: null },
      formData({ matterId, noteId, body: "Original note text.", pinned: "on" }),
    );
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: { changed: { pinned: { before: false, after: true } } },
      }),
    });
  });

  it("writes no audit event for a true no-op edit", async () => {
    prismaMock.note.findFirst.mockResolvedValue({ body: "Same text.", pinned: false });
    prismaMock.note.update.mockResolvedValue({});
    await updateNote({ error: null }, formData({ matterId, noteId, body: "Same text." }));
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("createTask", () => {
  it("rejects a missing title before touching the database", async () => {
    const result = await createTask({ error: null }, formData({ matterId, title: "" }));
    expect(result?.error).toBeTruthy();
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid due date", async () => {
    const result = await createTask(
      { error: null },
      formData({ matterId, title: "Follow up", dueDate: "not-a-date" }),
    );
    expect(result?.error).toBeTruthy();
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it("denies creation when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await createTask({ error: null }, formData({ matterId, title: "Follow up" }));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it("creates the task with a default priority and an audit event", async () => {
    prismaMock.task.create.mockResolvedValue({ id: "task-1" });
    const result = await createTask({ error: null }, formData({ matterId, title: "Follow up" }));
    expect(result.error).toBeNull();
    expect(prismaMock.task.create).toHaveBeenCalledWith({
      data: { matterId, title: "Follow up", description: undefined, dueDate: undefined, priority: "NORMAL" },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: { actorId: user.id, action: "CREATE", entityType: "Task", entityId: "task-1", matterId },
    });
  });

  it("returns a generic not-found instead of throwing when matterId is a forged/nonexistent id (e.g. an ADMIN whose hasMatterAccess bypasses the assignment check)", async () => {
    prismaMock.task.create.mockRejectedValue(fakePrismaError("P2003"));
    const result = await createTask({ error: null }, formData({ matterId, title: "Follow up" }));
    expect(result?.error).toBe("Not found or access denied.");
  });
});

describe("updateTask", () => {
  const taskId = "task-1";
  const validFields = {
    matterId,
    taskId,
    title: "Draft motion to suppress (revised)",
    priority: "HIGH",
    status: "IN_PROGRESS",
  };

  beforeEach(() => {
    prismaMock.task.findFirst.mockResolvedValue({
      title: "Draft motion to suppress",
      description: null,
      dueDate: null,
      priority: "NORMAL",
      status: "OPEN",
      assignedToId: null,
    });
  });

  it("rejects a missing title before touching the database", async () => {
    const result = await updateTask({ error: null }, formData({ ...validFields, title: "" }));
    expect(result?.error).toBeTruthy();
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it("denies the edit when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await updateTask({ error: null }, formData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the given matter, denying a cross-matter task id", async () => {
    prismaMock.task.findFirst.mockResolvedValue(null);
    const result = await updateTask({ error: null }, formData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.task.findFirst).toHaveBeenCalledWith({
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
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it("updates the task and writes an audit event with a before/after diff", async () => {
    prismaMock.task.update.mockResolvedValue({});
    const result = await updateTask({ error: null }, formData(validFields));
    expect(result.error).toBeNull();
    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: taskId },
      data: {
        title: "Draft motion to suppress (revised)",
        description: null,
        dueDate: null,
        priority: "HIGH",
        status: "IN_PROGRESS",
        assignedToId: null,
      },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UPDATE",
        entityType: "Task",
        entityId: taskId,
        matterId,
        metadata: {
          changed: expect.objectContaining({
            title: { before: "Draft motion to suppress", after: "Draft motion to suppress (revised)" },
            priority: { before: "NORMAL", after: "HIGH" },
            status: { before: "OPEN", after: "IN_PROGRESS" },
          }),
        },
      }),
    });
  });

  it("writes the same status column updateTaskStatus (Kanban) does, so a form edit and a drag never disagree", async () => {
    prismaMock.task.update.mockResolvedValue({});
    await updateTask({ error: null }, formData({ ...validFields, status: "DONE" }));
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DONE" }) }),
    );
  });

  it("records only that the description changed, never its content, in the audit event", async () => {
    prismaMock.task.findFirst.mockResolvedValue({
      title: "Draft motion to suppress",
      description: "Client disclosed a prior unrelated arrest — do not raise unprompted.",
      dueDate: null,
      priority: "NORMAL",
      status: "OPEN",
      assignedToId: null,
    });
    prismaMock.task.update.mockResolvedValue({});
    await updateTask(
      { error: null },
      formData({ ...validFields, description: "Updated strategy notes for the motion." }),
    );
    const call = prismaMock.auditEvent.create.mock.calls.at(0)?.[0];
    expect(call.data.metadata.descriptionChanged).toBe(true);
    expect(JSON.stringify(call)).not.toContain("prior unrelated arrest");
    expect(JSON.stringify(call)).not.toContain("Updated strategy notes");
  });

  it("writes no audit event for a true no-op edit", async () => {
    prismaMock.task.findFirst.mockResolvedValue({
      title: "Same title",
      description: null,
      dueDate: null,
      priority: "NORMAL",
      status: "OPEN",
      assignedToId: null,
    });
    prismaMock.task.update.mockResolvedValue({});
    await updateTask(
      { error: null },
      formData({ matterId, taskId, title: "Same title", priority: "NORMAL", status: "OPEN" }),
    );
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  describe("assignee validation", () => {
    const assigneeId = "user-assignee";

    it("rejects an assignee that doesn't exist or isn't active", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      const result = await updateTask(
        { error: null },
        formData({ ...validFields, assignedToId: assigneeId }),
      );
      expect(result.error).toBe("Selected assignee is invalid.");
      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it("rejects an inactive assignee even if the id is otherwise valid", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: assigneeId, role: "STAFF", active: false });
      const result = await updateTask(
        { error: null },
        formData({ ...validFields, assignedToId: assigneeId }),
      );
      expect(result.error).toBe("Selected assignee is invalid.");
      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it("rejects an active user who has no access to this matter (not assigned, not admin) — a forged assignedToId can't assign an outsider", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: assigneeId, role: "STAFF", active: true });
      // The caller's own matter access (checked first) succeeds; the
      // candidate assignee's matter access (checked second, against the
      // *candidate's* id/role) fails — hasMatterAccess is called with two
      // different user objects in the same request.
      hasMatterAccessMock.mockImplementation(async (candidate: { id: string }) =>
        candidate.id === user.id,
      );
      const result = await updateTask(
        { error: null },
        formData({ ...validFields, assignedToId: assigneeId }),
      );
      expect(result.error).toBe("Selected assignee does not have access to this matter.");
      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it("allows an active user who is genuinely assigned to the matter", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: assigneeId, role: "STAFF", active: true });
      hasMatterAccessMock.mockResolvedValue(true);
      prismaMock.task.update.mockResolvedValue({});
      const result = await updateTask(
        { error: null },
        formData({ ...validFields, assignedToId: assigneeId }),
      );
      expect(result.error).toBeNull();
      expect(prismaMock.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assignedToId: assigneeId }) }),
      );
    });

    it("allows an ADMIN assignee regardless of matter assignment", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: assigneeId, role: "ADMIN", active: true });
      hasMatterAccessMock.mockImplementation(async (candidate: { id: string; role: string }) =>
        candidate.id === user.id || candidate.role === "ADMIN",
      );
      prismaMock.task.update.mockResolvedValue({});
      const result = await updateTask(
        { error: null },
        formData({ ...validFields, assignedToId: assigneeId }),
      );
      expect(result.error).toBeNull();
    });

    it("allows clearing an assignee (empty selection) without any user lookup", async () => {
      prismaMock.task.update.mockResolvedValue({});
      const result = await updateTask({ error: null }, formData({ ...validFields, assignedToId: "" }));
      expect(result.error).toBeNull();
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assignedToId: null }) }),
      );
    });
  });
});

describe("updateTaskStatus", () => {
  it("denies the update when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await updateTaskStatus({ matterId, taskId: "task-1", status: "DONE" });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled();
  });

  it("scopes the update to the given matter, so a task from another matter can't be moved", async () => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 });
    const result = await updateTaskStatus({ matterId, taskId: "task-in-other-matter", status: "DONE" });
    expect(result.ok).toBe(false);
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith({
      where: { id: "task-in-other-matter", matterId },
      data: { status: "DONE" },
    });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("updates the status and writes an audit event on success", async () => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 });
    const result = await updateTaskStatus({ matterId, taskId: "task-1", status: "DONE" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Task",
        entityId: "task-1",
        matterId,
        metadata: { status: "DONE" },
      },
    });
  });
});

describe("createCall", () => {
  const validFields = {
    matterId,
    direction: "OUTBOUND",
    contactName: "Jordan Ellis",
    fromNumber: "555-0100",
    toNumber: "555-0142",
    occurredAt: "2026-08-09T10:00",
    durationSeconds: "180",
    notes: "Checked in about discovery status — client called back within the hour.",
  };

  it("rejects an invalid direction before touching the database", async () => {
    const result = await createCall({ error: null }, formData({ ...validFields, direction: "SIDEWAYS" }));
    expect(result?.error).toBeTruthy();
    expect(prismaMock.call.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed phone number", async () => {
    const result = await createCall({ error: null }, formData({ ...validFields, fromNumber: "not a number!" }));
    expect(result?.error).toBeTruthy();
    expect(prismaMock.call.create).not.toHaveBeenCalled();
  });

  it("rejects a negative duration", async () => {
    const result = await createCall({ error: null }, formData({ ...validFields, durationSeconds: "-5" }));
    expect(result?.error).toBeTruthy();
    expect(prismaMock.call.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid occurredAt value", async () => {
    const result = await createCall({ error: null }, formData({ ...validFields, occurredAt: "not-a-date" }));
    expect(result?.error).toBeTruthy();
    expect(prismaMock.call.create).not.toHaveBeenCalled();
  });

  it("denies filing to a matter the user lacks access to, with a generic error", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await createCall({ error: null }, formData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.call.create).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("never checks matter access for an unfiled call (no matterId submitted)", async () => {
    prismaMock.call.create.mockResolvedValue({ id: "call-new" });
    const fieldsWithNoMatter: Record<string, string> = { ...validFields };
    delete fieldsWithNoMatter.matterId;
    const result = await createCall({ error: null }, formData(fieldsWithNoMatter));
    expect(result.error).toBeNull();
    expect(hasMatterAccessMock).not.toHaveBeenCalled();
    expect(prismaMock.call.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matterId: null,
        filedById: null,
        filedAt: null,
      }),
    });
  });

  it("creates a filed call, setting filedById/filedAt, and writes an audit event", async () => {
    prismaMock.call.create.mockResolvedValue({ id: "call-new" });
    const result = await createCall({ error: null }, formData(validFields));
    expect(result.error).toBeNull();
    expect(prismaMock.call.create).toHaveBeenCalledWith({
      data: {
        matterId,
        contactName: "Jordan Ellis",
        direction: "OUTBOUND",
        fromNumber: "555-0100",
        toNumber: "555-0142",
        occurredAt: new Date("2026-08-09T10:00"),
        durationSeconds: 180,
        notes: validFields.notes,
        flagged: false,
        filedById: user.id,
        filedAt: expect.any(Date),
      },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        action: "CREATE",
        entityType: "Call",
        entityId: "call-new",
        matterId,
        metadata: { direction: "OUTBOUND", filed: true, flagged: false, notesProvided: true },
      },
    });
  });

  it("never copies the notes text into the audit event", async () => {
    prismaMock.call.create.mockResolvedValue({ id: "call-new" });
    await createCall({ error: null }, formData(validFields));
    const auditCall = prismaMock.auditEvent.create.mock.calls[0]?.[0];
    expect(JSON.stringify(auditCall)).not.toContain("discovery status");
    expect(JSON.stringify(auditCall)).not.toContain("555-0100");
  });

  it("records notesProvided: false when no notes are given", async () => {
    prismaMock.call.create.mockResolvedValue({ id: "call-new" });
    const fieldsWithNoNotes: Record<string, string> = { ...validFields };
    delete fieldsWithNoNotes.notes;
    await createCall({ error: null }, formData(fieldsWithNoNotes));
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: expect.objectContaining({ notesProvided: false }) }),
      }),
    );
  });

  it("reads the flagged checkbox as true only when checked", async () => {
    prismaMock.call.create.mockResolvedValue({ id: "call-new" });
    await createCall({ error: null }, formData({ ...validFields, flagged: "on" }));
    expect(prismaMock.call.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flagged: true }) }),
    );
  });

  it("returns a generic not-found instead of throwing when matterId is a forged/nonexistent id", async () => {
    prismaMock.call.create.mockRejectedValue(fakePrismaError("P2003"));
    const result = await createCall({ error: null }, formData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
  });
});

describe("attachCallToMatter", () => {
  // Unfiled calls are only ever visible to ADMIN/ATTORNEY (see
  // lib/communications/queries.ts#getCallVisibilityFilter) — filing one
  // must be gated the same way, or a PARALEGAL/STAFF caller could file a
  // call they were never authorized to see in the first place.
  it("denies PARALEGAL/STAFF regardless of matter access", async () => {
    requireCurrentUserMock.mockResolvedValue(user); // STAFF
    hasMatterAccessMock.mockResolvedValue(true);
    const result = await attachCallToMatter({ matterId, callId: "call-1" });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled();
  });

  it("denies attaching when the ATTORNEY lacks matter access", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await attachCallToMatter({ matterId, callId: "call-1" });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled();
  });

  it("only attaches calls that are still unfiled, and reports failure otherwise", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    hasMatterAccessMock.mockResolvedValue(true);
    prismaMock.call.updateMany.mockResolvedValue({ count: 0 });
    const result = await attachCallToMatter({ matterId, callId: "already-filed-call" });
    expect(result.ok).toBe(false);
    expect(prismaMock.call.updateMany).toHaveBeenCalledWith({
      where: { id: "already-filed-call", matterId: null },
      data: expect.objectContaining({ matterId, filedById: attorney.id }),
    });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("attaches an unfiled call and writes an audit event on success", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    hasMatterAccessMock.mockResolvedValue(true);
    prismaMock.call.updateMany.mockResolvedValue({ count: 1 });
    const result = await attachCallToMatter({ matterId, callId: "call-1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: attorney.id,
        action: "UPDATE",
        entityType: "Call",
        entityId: "call-1",
        matterId,
        metadata: { attached: true },
      },
    });
  });

  it("returns a generic not-found instead of throwing when matterId is a forged/nonexistent id", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    hasMatterAccessMock.mockResolvedValue(true);
    prismaMock.call.updateMany.mockRejectedValue(fakePrismaError("P2003"));
    const result = await attachCallToMatter({ matterId, callId: "call-1" });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
  });
});

function matterFormData(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v);
    } else {
      fd.set(key, value);
    }
  }
  return fd;
}

describe("createMatter", () => {
  const validFields = {
    clientId: "client-1",
    caseNumber: "26-CR-00001",
    court: "Fulton County Superior Court (fictional)",
    charges: "Trespassing",
    status: "OPEN",
    openedDate: "2026-08-01",
    assignmentUserId: ["staff-1"],
    assignmentRole: ["LEAD_ATTORNEY"],
  };

  it("denies creation for a role that isn't ADMIN or ATTORNEY", async () => {
    requireCurrentUserMock.mockResolvedValue(user); // STAFF
    const result = await createMatter({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.matter.create).not.toHaveBeenCalled();
  });

  it("rejects a submission with no staff assignments before touching the database", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    const fieldsWithNoAssignments: Record<string, string | string[]> = { ...validFields };
    delete fieldsWithNoAssignments.assignmentUserId;
    delete fieldsWithNoAssignments.assignmentRole;
    const result = await createMatter({ error: null }, matterFormData(fieldsWithNoAssignments));
    expect(result?.error).toBeTruthy();
    expect(prismaMock.matter.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid opened date", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    const result = await createMatter(
      { error: null },
      matterFormData({ ...validFields, openedDate: "not-a-date" }),
    );
    expect(result?.error).toBeTruthy();
    expect(prismaMock.matter.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown client id without touching matter.create", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    prismaMock.client.findUnique.mockResolvedValue(null);
    const result = await createMatter({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("Selected client not found.");
    expect(prismaMock.matter.create).not.toHaveBeenCalled();
  });

  it("rejects a closed date before the opened date", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    const result = await createMatter(
      { error: null },
      matterFormData({ ...validFields, openedDate: "2026-08-10", closedDate: "2020-01-01" }),
    );
    expect(result?.error).toBe("Closed date can't be before the opened date.");
    expect(prismaMock.matter.create).not.toHaveBeenCalled();
  });

  it("allows a closed date equal to the opened date", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    prismaMock.client.findUnique.mockResolvedValue({ id: "client-1" });
    prismaMock.user.findMany.mockResolvedValue([{ id: "staff-1" }]);
    prismaMock.matter.create.mockResolvedValue({ id: "matter-new", assignments: [] });
    await expect(
      createMatter(
        { error: null },
        matterFormData({ ...validFields, openedDate: "2026-08-10", closedDate: "2026-08-10", status: "CLOSED" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.matter.create).toHaveBeenCalled();
  });

  it("rejects an assignment referencing an inactive or nonexistent user", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    prismaMock.client.findUnique.mockResolvedValue({ id: "client-1" });
    prismaMock.user.findMany.mockResolvedValue([]); // "staff-1" not found/active
    const result = await createMatter({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("One or more selected staff members are invalid.");
    expect(prismaMock.matter.create).not.toHaveBeenCalled();
  });

  it("creates the matter with its initial assignment and audit events, then redirects", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    prismaMock.client.findUnique.mockResolvedValue({ id: "client-1" });
    prismaMock.user.findMany.mockResolvedValue([{ id: "staff-1" }]);
    prismaMock.matter.create.mockResolvedValue({
      id: "matter-new",
      assignments: [{ id: "assignment-1", userId: "staff-1", role: "LEAD_ATTORNEY" }],
    });

    await expect(createMatter({ error: null }, matterFormData(validFields))).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(prismaMock.matter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: "client-1",
          caseNumber: "26-CR-00001",
          assignments: { create: [{ userId: "staff-1", role: "LEAD_ATTORNEY" }] },
        }),
      }),
    );
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CREATE", entityType: "Matter", entityId: "matter-new" }),
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "CREATE",
        entityType: "MatterAssignment",
        entityId: "assignment-1",
      }),
    });
    expect(redirectMock).toHaveBeenCalledWith("/matters/matter-new");
  });
});

describe("updateMatter", () => {
  const validFields = {
    matterId,
    caseNumber: "26-CR-00001",
    court: "Fulton County Superior Court (fictional)",
    charges: "Trespassing",
    status: "OPEN",
    openedDate: "2026-08-01",
  };

  beforeEach(() => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    prismaMock.matter.findUnique.mockResolvedValue({
      caseNumber: "26-CR-00000",
      court: "Old Court",
      charges: "Old charge",
      status: "OPEN",
      openedDate: new Date("2026-07-01"),
      closedDate: null,
    });
  });

  it("denies the update when the caller can't edit this matter (ID scoping)", async () => {
    canEditMatterMock.mockResolvedValue(false);
    const result = await updateMatter({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
  });

  it("rejects a missing case number before touching the database", async () => {
    const result = await updateMatter(
      { error: null },
      matterFormData({ ...validFields, caseNumber: "" }),
    );
    expect(result?.error).toBeTruthy();
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
  });

  it("rejects a closed date before the opened date", async () => {
    const result = await updateMatter(
      { error: null },
      matterFormData({ ...validFields, openedDate: "2026-08-10", closedDate: "2020-01-01" }),
    );
    expect(result?.error).toBe("Closed date can't be before the opened date.");
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
  });

  it("updates the matter and writes an audit event with a before/after diff, then redirects", async () => {
    prismaMock.matter.update.mockResolvedValue({});
    await expect(updateMatter({ error: null }, matterFormData(validFields))).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(prismaMock.matter.update).toHaveBeenCalledWith({
      where: { id: matterId },
      data: expect.objectContaining({ caseNumber: "26-CR-00001", court: "Fulton County Superior Court (fictional)" }),
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UPDATE",
        entityType: "Matter",
        entityId: matterId,
        metadata: expect.objectContaining({
          changed: expect.objectContaining({
            caseNumber: { before: "26-CR-00000", after: "26-CR-00001" },
          }),
        }),
      }),
    });
    expect(redirectMock).toHaveBeenCalledWith(`/matters/${matterId}`);
  });

  it("writes no audit event when nothing actually changed", async () => {
    prismaMock.matter.update.mockResolvedValue({});
    const unchanged = {
      matterId,
      caseNumber: "26-CR-00000",
      court: "Old Court",
      charges: "Old charge",
      status: "OPEN",
      openedDate: "2026-07-01",
    };
    await expect(updateMatter({ error: null }, matterFormData(unchanged))).rejects.toThrow("NEXT_REDIRECT");
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("archiveMatter", () => {
  it("denies archiving when the caller can't edit this matter (e.g. an unassigned ATTORNEY, or a forged/inaccessible matter id)", async () => {
    canEditMatterMock.mockResolvedValue(false);
    const result = await archiveMatter({ matterId });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("allows an ADMIN to archive any accessible matter", async () => {
    requireCurrentUserMock.mockResolvedValue(admin);
    prismaMock.matter.findUnique.mockResolvedValue({ archived: false });
    prismaMock.matter.update.mockResolvedValue({});
    const result = await archiveMatter({ matterId });
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it("allows an ATTORNEY assigned to this matter (canEditMatter true) to archive it", async () => {
    requireCurrentUserMock.mockResolvedValue(attorney);
    prismaMock.matter.findUnique.mockResolvedValue({ archived: false });
    prismaMock.matter.update.mockResolvedValue({});
    const result = await archiveMatter({ matterId });
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it("returns a generic not-found for a nonexistent matter id, not a distinct error", async () => {
    prismaMock.matter.findUnique.mockResolvedValue(null);
    const result = await archiveMatter({ matterId: "matter-does-not-exist" });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
  });

  it("refuses to re-archive an already-archived matter", async () => {
    prismaMock.matter.findUnique.mockResolvedValue({ archived: true });
    const result = await archiveMatter({ matterId });
    expect(result).toEqual({ ok: false, error: "This matter is already archived." });
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
  });

  it("sets archived/archivedAt/archivedById and writes a safe UPDATE audit event", async () => {
    prismaMock.matter.findUnique.mockResolvedValue({ archived: false });
    prismaMock.matter.update.mockResolvedValue({});
    await archiveMatter({ matterId });

    expect(prismaMock.matter.update).toHaveBeenCalledWith({
      where: { id: matterId },
      data: { archived: true, archivedAt: expect.any(Date), archivedById: user.id },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Matter",
        entityId: matterId,
        matterId,
        metadata: { archived: true },
      },
    });
  });

  it("never touches status/closedDate or any sub-resource — only the archived fields", async () => {
    prismaMock.matter.findUnique.mockResolvedValue({ archived: false });
    prismaMock.matter.update.mockResolvedValue({});
    await archiveMatter({ matterId });
    const call = prismaMock.matter.update.mock.calls.at(0)?.[0];
    expect(call.data).not.toHaveProperty("status");
    expect(call.data).not.toHaveProperty("closedDate");
  });
});

describe("reactivateMatter", () => {
  it("denies reactivation when the caller can't edit this matter", async () => {
    canEditMatterMock.mockResolvedValue(false);
    const result = await reactivateMatter({ matterId });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
  });

  it("returns a generic not-found for a nonexistent matter id", async () => {
    prismaMock.matter.findUnique.mockResolvedValue(null);
    const result = await reactivateMatter({ matterId });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
  });

  it("refuses to reactivate a matter that isn't archived", async () => {
    prismaMock.matter.findUnique.mockResolvedValue({ archived: false });
    const result = await reactivateMatter({ matterId });
    expect(result).toEqual({ ok: false, error: "This matter is not archived." });
    expect(prismaMock.matter.update).not.toHaveBeenCalled();
  });

  it("clears archived/archivedAt/archivedById and writes a safe UPDATE audit event", async () => {
    prismaMock.matter.findUnique.mockResolvedValue({ archived: true });
    prismaMock.matter.update.mockResolvedValue({});
    const result = await reactivateMatter({ matterId });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(prismaMock.matter.update).toHaveBeenCalledWith({
      where: { id: matterId },
      data: { archived: false, archivedAt: null, archivedById: null },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Matter",
        entityId: matterId,
        matterId,
        metadata: { archived: false },
      },
    });
  });
});

describe("addMatterAssignment", () => {
  it("denies adding an assignment when the caller can't edit this matter", async () => {
    canEditMatterMock.mockResolvedValue(false);
    const result = await addMatterAssignment({ matterId, userId: "staff-2", role: "PARALEGAL" });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.matterAssignment.create).not.toHaveBeenCalled();
  });

  it("rejects an inactive or nonexistent user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const result = await addMatterAssignment({ matterId, userId: "staff-2", role: "PARALEGAL" });
    expect(result).toEqual({ ok: false, error: "Selected staff member is invalid." });
    expect(prismaMock.matterAssignment.create).not.toHaveBeenCalled();
  });

  it("adds the assignment and writes an audit event on success", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ active: true });
    prismaMock.matterAssignment.create.mockResolvedValue({ id: "assignment-2" });
    const result = await addMatterAssignment({ matterId, userId: "staff-2", role: "PARALEGAL" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "CREATE",
        entityType: "MatterAssignment",
        entityId: "assignment-2",
        matterId,
        metadata: { userId: "staff-2", role: "PARALEGAL" },
      }),
    });
  });
});

describe("removeMatterAssignment", () => {
  it("denies removal when the caller can't edit this matter", async () => {
    canEditMatterMock.mockResolvedValue(false);
    const result = await removeMatterAssignment({ matterId, assignmentId: "assignment-1" });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.matterAssignment.deleteMany).not.toHaveBeenCalled();
  });

  it("scopes deletion to the given matter, so an assignment from another matter can't be removed", async () => {
    prismaMock.matterAssignment.deleteMany.mockResolvedValue({ count: 0 });
    const result = await removeMatterAssignment({ matterId, assignmentId: "assignment-in-other-matter" });
    expect(result.ok).toBe(false);
    expect(prismaMock.matterAssignment.deleteMany).toHaveBeenCalledWith({
      where: { id: "assignment-in-other-matter", matterId },
    });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("removes the assignment and writes an audit event on success", async () => {
    prismaMock.matterAssignment.count.mockResolvedValue(2);
    prismaMock.matterAssignment.deleteMany.mockResolvedValue({ count: 1 });
    const result = await removeMatterAssignment({ matterId, assignmentId: "assignment-1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "DELETE",
        entityType: "MatterAssignment",
        entityId: "assignment-1",
        matterId,
      }),
    });
  });

  it("refuses to remove a matter's last remaining assignment, server-side, even if a caller bypasses the UI's own disabled-button guard", async () => {
    prismaMock.matterAssignment.count.mockResolvedValue(1);
    const result = await removeMatterAssignment({ matterId, assignmentId: "assignment-1" });
    expect(result).toEqual({ ok: false, error: "A matter must always have at least one staff assignment." });
    expect(prismaMock.matterAssignment.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("createDeadline", () => {
  const validFields = {
    matterId,
    type: "FILING",
    date: "2026-09-05",
    description: "Deadline to file pretrial motions",
    reminderDaysBefore: "10",
  };

  it("rejects a missing description before touching the database", async () => {
    const result = await createDeadline(
      { error: null },
      matterFormData({ ...validFields, description: "" }),
    );
    expect(result?.error).toBeTruthy();
    expect(prismaMock.deadline.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid date", async () => {
    const result = await createDeadline(
      { error: null },
      matterFormData({ ...validFields, date: "not-a-date" }),
    );
    expect(result?.error).toBeTruthy();
    expect(prismaMock.deadline.create).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range reminder value", async () => {
    const result = await createDeadline(
      { error: null },
      matterFormData({ ...validFields, reminderDaysBefore: "9999" }),
    );
    expect(result?.error).toBeTruthy();
    expect(prismaMock.deadline.create).not.toHaveBeenCalled();
  });

  it("denies creation when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await createDeadline({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.deadline.create).not.toHaveBeenCalled();
  });

  it("creates the deadline with a default reminder and an audit event", async () => {
    prismaMock.deadline.create.mockResolvedValue({ id: "deadline-1" });
    const result = await createDeadline({ error: null }, matterFormData(validFields));
    expect(result.error).toBeNull();
    expect(prismaMock.deadline.create).toHaveBeenCalledWith({
      data: {
        matterId,
        type: "FILING",
        date: new Date("2026-09-05"),
        description: "Deadline to file pretrial motions",
        reminderDaysBefore: 10,
      },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CREATE", entityType: "Deadline", entityId: "deadline-1", matterId }),
    });
  });

  it("defaults reminderDaysBefore to 7 when omitted", async () => {
    prismaMock.deadline.create.mockResolvedValue({ id: "deadline-2" });
    const fieldsWithNoReminder: Record<string, string> = { ...validFields };
    delete fieldsWithNoReminder.reminderDaysBefore;
    await createDeadline({ error: null }, matterFormData(fieldsWithNoReminder));
    expect(prismaMock.deadline.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reminderDaysBefore: 7 }) }),
    );
  });

  it("returns a generic not-found instead of throwing when matterId is a forged/nonexistent id", async () => {
    prismaMock.deadline.create.mockRejectedValue(fakePrismaError("P2003"));
    const result = await createDeadline({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
  });
});

describe("updateDeadline", () => {
  const deadlineId = "deadline-1";
  const validFields = {
    matterId,
    deadlineId,
    type: "FILING",
    date: "2026-09-05",
    description: "Amended filing deadline",
    reminderDaysBefore: "10",
  };

  beforeEach(() => {
    prismaMock.deadline.findFirst.mockResolvedValue({
      type: "FILING",
      date: new Date("2026-08-01"),
      description: "Original filing deadline",
      reminderDaysBefore: 7,
    });
  });

  it("denies the update when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await updateDeadline({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.deadline.update).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the given matter, denying a cross-matter deadline id", async () => {
    prismaMock.deadline.findFirst.mockResolvedValue(null);
    const result = await updateDeadline({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.deadline.findFirst).toHaveBeenCalledWith({
      where: { id: deadlineId, matterId },
      select: { type: true, date: true, description: true, reminderDaysBefore: true },
    });
    expect(prismaMock.deadline.update).not.toHaveBeenCalled();
  });

  it("updates the deadline and writes an audit event with a before/after diff", async () => {
    prismaMock.deadline.update.mockResolvedValue({});
    const result = await updateDeadline({ error: null }, matterFormData(validFields));
    expect(result.error).toBeNull();
    expect(prismaMock.deadline.update).toHaveBeenCalledWith({
      where: { id: deadlineId },
      data: {
        type: "FILING",
        date: new Date("2026-09-05"),
        description: "Amended filing deadline",
        reminderDaysBefore: 10,
      },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UPDATE",
        entityType: "Deadline",
        entityId: deadlineId,
        metadata: {
          changed: expect.objectContaining({
            description: { before: "Original filing deadline", after: "Amended filing deadline" },
          }),
        },
      }),
    });
  });

  it("writes no audit event when nothing actually changed", async () => {
    prismaMock.deadline.findFirst.mockResolvedValue({
      type: "FILING",
      date: new Date("2026-09-05"),
      description: "Amended filing deadline",
      reminderDaysBefore: 10,
    });
    prismaMock.deadline.update.mockResolvedValue({});
    await updateDeadline({ error: null }, matterFormData(validFields));
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("setDeadlineSatisfied", () => {
  it("denies the status change when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await setDeadlineSatisfied({ matterId, deadlineId: "deadline-1", satisfied: true });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.deadline.updateMany).not.toHaveBeenCalled();
  });

  it("scopes the update to the given matter, so a deadline from another matter can't be toggled", async () => {
    prismaMock.deadline.updateMany.mockResolvedValue({ count: 0 });
    const result = await setDeadlineSatisfied({
      matterId,
      deadlineId: "deadline-in-other-matter",
      satisfied: true,
    });
    expect(result.ok).toBe(false);
    expect(prismaMock.deadline.updateMany).toHaveBeenCalledWith({
      where: { id: "deadline-in-other-matter", matterId },
      data: expect.objectContaining({ satisfied: true }),
    });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("marks a deadline satisfied, sets satisfiedAt, and writes an audit event", async () => {
    prismaMock.deadline.updateMany.mockResolvedValue({ count: 1 });
    const result = await setDeadlineSatisfied({ matterId, deadlineId: "deadline-1", satisfied: true });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(prismaMock.deadline.updateMany).toHaveBeenCalledWith({
      where: { id: "deadline-1", matterId },
      data: { satisfied: true, satisfiedAt: expect.any(Date) },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UPDATE",
        entityType: "Deadline",
        entityId: "deadline-1",
        matterId,
        metadata: { satisfied: true },
      }),
    });
  });

  it("marks a deadline incomplete and clears satisfiedAt", async () => {
    prismaMock.deadline.updateMany.mockResolvedValue({ count: 1 });
    await setDeadlineSatisfied({ matterId, deadlineId: "deadline-1", satisfied: false });
    expect(prismaMock.deadline.updateMany).toHaveBeenCalledWith({
      where: { id: "deadline-1", matterId },
      data: { satisfied: false, satisfiedAt: null },
    });
  });
});

describe("createCalendarEvent", () => {
  const validFields = {
    matterId,
    title: "Pretrial Conference",
    type: "HEARING",
    startTime: "2026-08-19T14:00",
    endTime: "2026-08-19T14:30",
    location: "Courtroom 4B",
  };

  it("rejects a missing title before touching the database", async () => {
    const result = await createCalendarEvent(
      { error: null },
      matterFormData({ ...validFields, title: "" }),
    );
    expect(result?.error).toBeTruthy();
    expect(prismaMock.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("rejects an end time before the start time", async () => {
    const result = await createCalendarEvent(
      { error: null },
      matterFormData({ ...validFields, startTime: "2026-08-19T14:00", endTime: "2026-08-19T13:00" }),
    );
    expect(result?.error).toBeTruthy();
    expect(prismaMock.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("allows an event with no end time at all", async () => {
    prismaMock.calendarEvent.create.mockResolvedValue({ id: "event-1" });
    const fieldsWithNoEndTime: Record<string, string> = { ...validFields };
    delete fieldsWithNoEndTime.endTime;
    const result = await createCalendarEvent({ error: null }, matterFormData(fieldsWithNoEndTime));
    expect(result.error).toBeNull();
    expect(prismaMock.calendarEvent.create).toHaveBeenCalled();
  });

  it("denies creation when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await createCalendarEvent({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.calendarEvent.create).not.toHaveBeenCalled();
  });

  it("creates the event and an audit event", async () => {
    prismaMock.calendarEvent.create.mockResolvedValue({ id: "event-1" });
    const result = await createCalendarEvent({ error: null }, matterFormData(validFields));
    expect(result.error).toBeNull();
    expect(prismaMock.calendarEvent.create).toHaveBeenCalledWith({
      data: {
        matterId,
        title: "Pretrial Conference",
        type: "HEARING",
        startTime: new Date("2026-08-19T14:00"),
        endTime: new Date("2026-08-19T14:30"),
        location: "Courtroom 4B",
        notes: undefined,
      },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CREATE", entityType: "CalendarEvent", entityId: "event-1", matterId }),
    });
  });

  it("returns a generic not-found instead of throwing when matterId is a forged/nonexistent id", async () => {
    prismaMock.calendarEvent.create.mockRejectedValue(fakePrismaError("P2003"));
    const result = await createCalendarEvent({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
  });
});

describe("updateCalendarEvent", () => {
  const eventId = "event-1";
  const validFields = {
    matterId,
    eventId,
    title: "Pretrial Conference (rescheduled)",
    type: "HEARING",
    startTime: "2026-08-20T14:00",
    endTime: "2026-08-20T14:30",
    location: "Courtroom 4B",
  };

  beforeEach(() => {
    prismaMock.calendarEvent.findFirst.mockResolvedValue({
      title: "Pretrial Conference",
      type: "HEARING",
      startTime: new Date("2026-08-19T14:00:00.000Z"),
      endTime: new Date("2026-08-19T14:30:00.000Z"),
      location: "Courtroom 4B",
      notes: null,
    });
  });

  it("denies the update when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await updateCalendarEvent({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the given matter, denying a cross-matter event id", async () => {
    prismaMock.calendarEvent.findFirst.mockResolvedValue(null);
    const result = await updateCalendarEvent({ error: null }, matterFormData(validFields));
    expect(result?.error).toBe("Not found or access denied.");
    expect(prismaMock.calendarEvent.findFirst).toHaveBeenCalledWith({
      where: { id: eventId, matterId },
      select: { title: true, type: true, startTime: true, endTime: true, location: true, notes: true },
    });
    expect(prismaMock.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("rejects an end time before the start time on edit too", async () => {
    const result = await updateCalendarEvent(
      { error: null },
      matterFormData({ ...validFields, startTime: "2026-08-20T14:00", endTime: "2026-08-20T13:00" }),
    );
    expect(result?.error).toBeTruthy();
    expect(prismaMock.calendarEvent.update).not.toHaveBeenCalled();
  });

  it("updates the event and writes an audit event with a before/after diff", async () => {
    prismaMock.calendarEvent.update.mockResolvedValue({});
    const result = await updateCalendarEvent({ error: null }, matterFormData(validFields));
    expect(result.error).toBeNull();
    expect(prismaMock.calendarEvent.update).toHaveBeenCalledWith({
      where: { id: eventId },
      data: {
        title: "Pretrial Conference (rescheduled)",
        type: "HEARING",
        startTime: new Date("2026-08-20T14:00"),
        endTime: new Date("2026-08-20T14:30"),
        location: "Courtroom 4B",
        notes: null,
      },
    });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UPDATE",
        entityType: "CalendarEvent",
        entityId: eventId,
        metadata: expect.objectContaining({
          changed: expect.objectContaining({
            title: { before: "Pretrial Conference", after: "Pretrial Conference (rescheduled)" },
          }),
        }),
      }),
    });
  });
});
