import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCurrentUserMock, hasMatterAccessMock, prismaMock, revalidatePathMock } = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  hasMatterAccessMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  prismaMock: {
    note: { create: vi.fn() },
    task: { create: vi.fn(), updateMany: vi.fn() },
    call: { updateMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/auth/access", () => ({ hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { attachCallToMatter, createNote, createTask, updateTaskStatus } = await import(
  "@/lib/matters/actions"
);

const user = { id: "user-1", role: "STAFF" as const };
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

describe("attachCallToMatter", () => {
  it("denies attaching when the user lacks matter access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const result = await attachCallToMatter({ matterId, callId: "call-1" });
    expect(result).toEqual({ ok: false, error: "Not found or access denied." });
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled();
  });

  it("only attaches calls that are still unfiled, and reports failure otherwise", async () => {
    prismaMock.call.updateMany.mockResolvedValue({ count: 0 });
    const result = await attachCallToMatter({ matterId, callId: "already-filed-call" });
    expect(result.ok).toBe(false);
    expect(prismaMock.call.updateMany).toHaveBeenCalledWith({
      where: { id: "already-filed-call", matterId: null },
      data: expect.objectContaining({ matterId, filedById: user.id }),
    });
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  });

  it("attaches an unfiled call and writes an audit event on success", async () => {
    prismaMock.call.updateMany.mockResolvedValue({ count: 1 });
    const result = await attachCallToMatter({ matterId, callId: "call-1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Call",
        entityId: "call-1",
        matterId,
        metadata: { attached: true },
      },
    });
  });
});
