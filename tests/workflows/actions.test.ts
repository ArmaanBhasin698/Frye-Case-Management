import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { requireCurrentUserMock, prismaMock, txMock } = vi.hoisted(() => {
  const model = () => ({
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  });
  const txMock = {
    workflowTemplate: model(),
    workflowTemplateVersion: model(),
    workflowApplication: model(),
    task: model(),
    calendarEvent: model(),
    auditEvent: model(),
  };
  return {
    requireCurrentUserMock: vi.fn(),
    txMock,
    prismaMock: {
      user: model(),
      matter: model(),
      matterAssignment: model(),
      workflowTemplate: model(),
      workflowTemplateVersion: model(),
      workflowApplication: model(),
      task: model(),
      calendarEvent: model(),
      auditEvent: model(),
      $transaction: vi.fn(),
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const {
  applyWorkflow,
  createWorkflowTemplate,
  previewWorkflow,
  recalculateWorkflow,
  saveWorkflowTemplateVersion,
  setWorkflowTemplateStatus,
} = await import("@/lib/workflows/actions");

const admin = { id: "u-admin", role: "ADMIN" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const paralegal = { id: "u-para", role: "PARALEGAL" as const };
const staff = { id: "u-staff", role: "STAFF" as const };
const NOT_FOUND = "Not found or access denied.";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const taskStep = {
  id: "step-task",
  position: 0,
  kind: "TASK",
  title: "Fictional: request discovery",
  description: "Privileged strategy note",
  priority: "HIGH",
  offsetDays: 2,
  timeOfDay: null,
  durationMinutes: null,
  eventType: null,
  assigneeRule: "LEAD_ATTORNEY",
  assigneeUserId: null,
};
const eventStep = {
  ...taskStep,
  id: "step-event",
  position: 1,
  kind: "EVENT",
  title: "Fictional: client meeting",
  timeOfDay: "10:00",
  durationMinutes: 45,
  eventType: "CLIENT_MEETING",
  assigneeRule: "SPECIFIC_USER",
  assigneeUserId: "u-outsider",
};

function mockVersion(opts: { status?: string; latest?: number } = {}) {
  prismaMock.workflowTemplateVersion.findUnique.mockResolvedValue({
    id: "ver-1",
    version: 1,
    templateId: "tpl-1",
    template: { id: "tpl-1", name: "Fictional template", status: opts.status ?? "ACTIVE" },
    steps: [taskStep, eventStep],
  });
  prismaMock.workflowTemplateVersion.aggregate.mockResolvedValue({ _max: { version: opts.latest ?? 1 } });
}

const applyFields = { matterId: "m-1", templateVersionId: "ver-1", anchorDate: "2026-03-06", timeZone: "America/New_York", requestKey: "req-key-0001" };

beforeEach(() => {
  vi.clearAllMocks();
  requireCurrentUserMock.mockResolvedValue(admin);
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(txMock) : Promise.all(arg as Promise<unknown>[]),
  );
  prismaMock.matter.findUnique.mockResolvedValue({ id: "m-1" });
  prismaMock.matterAssignment.count.mockResolvedValue(1);
  prismaMock.matterAssignment.findMany.mockResolvedValue([
    { role: "LEAD_ATTORNEY", assignedAt: new Date("2026-01-01"), user: { id: "u-att", name: "Lead", status: "ACTIVE" } },
  ]);
  prismaMock.user.findMany.mockResolvedValue([{ id: "u-admin", name: "Admin", status: "ACTIVE" }]);
  prismaMock.user.count.mockResolvedValue(1);
  prismaMock.workflowApplication.findUnique.mockResolvedValue(null);
  txMock.workflowApplication.create.mockResolvedValue({ id: "app-1" });
  txMock.workflowTemplate.create.mockResolvedValue({ id: "tpl-new" });
  txMock.workflowTemplateVersion.aggregate.mockResolvedValue({ _max: { version: 3 } });
  mockVersion();
});

describe("template management is ADMIN-only", () => {
  const templateForm = () =>
    fd({ name: "Fictional", category: "OTHER", steps: JSON.stringify([{ kind: "TASK", title: "Step", offsetDays: 1 }]) });

  it("denies non-admins", async () => {
    for (const user of [attorney, paralegal, staff]) {
      requireCurrentUserMock.mockResolvedValue(user);
      expect((await createWorkflowTemplate({ error: null }, templateForm())).error).toBe(NOT_FOUND);
      expect((await saveWorkflowTemplateVersion({ error: null }, fd({ templateId: "tpl-1" }))).error).toBe(NOT_FOUND);
      expect(await setWorkflowTemplateStatus({ templateId: "tpl-1", status: "ARCHIVED" })).toEqual({ ok: false, error: NOT_FOUND });
    }
    expect(txMock.workflowTemplate.create).not.toHaveBeenCalled();
  });

  it("creates version 1 with ordered steps; audit carries counts only", async () => {
    await expect(createWorkflowTemplate({ error: null }, templateForm())).rejects.toThrow("NEXT_REDIRECT");
    const data = txMock.workflowTemplate.create.mock.calls[0]![0].data;
    expect(data.versions.create).toMatchObject({ version: 1, steps: { create: [expect.objectContaining({ position: 0, title: "Step" })] } });
    expect(JSON.stringify(txMock.auditEvent.create.mock.calls)).not.toContain("Step");
  });

  it("rejects a forged/inactive specific-user assignee", async () => {
    prismaMock.user.count.mockResolvedValue(0);
    const result = await createWorkflowTemplate(
      { error: null },
      fd({ name: "x", category: "OTHER", steps: JSON.stringify([{ kind: "TASK", title: "s", offsetDays: 0, assigneeRule: "SPECIFIC_USER", assigneeUserId: "forged" }]) }),
    );
    expect(result.error).toMatch(/active staff/);
  });

  it("editing writes the next immutable version and never touches earlier versions or created tasks", async () => {
    prismaMock.workflowTemplate.findUnique.mockResolvedValue({ id: "tpl-1" });
    const result = await saveWorkflowTemplateVersion(
      { error: null },
      fd({ templateId: "tpl-1", name: "Renamed", category: "OTHER", steps: JSON.stringify([{ kind: "TASK", title: "New", offsetDays: 5 }]) }),
    );
    expect(result.error).toBeNull();
    expect(txMock.workflowTemplateVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ templateId: "tpl-1", version: 4 }) });
    expect(txMock.workflowTemplateVersion.update).not.toHaveBeenCalled();
    expect(txMock.task.update).not.toHaveBeenCalled();
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it("returns not-found for a forged template id", async () => {
    prismaMock.workflowTemplate.findUnique.mockResolvedValue(null);
    const result = await saveWorkflowTemplateVersion(
      { error: null },
      fd({ templateId: "forged", name: "x", category: "OTHER", steps: JSON.stringify([{ kind: "TASK", title: "s", offsetDays: 0 }]) }),
    );
    expect(result.error).toBe(NOT_FOUND);
  });
});

describe("who may preview/apply", () => {
  it("allows ADMIN and assigned ATTORNEY/PARALEGAL; denies STAFF and unassigned users", async () => {
    requireCurrentUserMock.mockResolvedValue(paralegal);
    expect((await previewWorkflow(applyFields)).ok).toBe(true);
    requireCurrentUserMock.mockResolvedValue(staff);
    expect(await previewWorkflow(applyFields)).toEqual({ ok: false, error: NOT_FOUND });
    requireCurrentUserMock.mockResolvedValue(attorney);
    prismaMock.matterAssignment.count.mockResolvedValue(0);
    expect(await previewWorkflow(applyFields)).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("rejects forged matter and version ids", async () => {
    prismaMock.matter.findUnique.mockResolvedValue(null);
    expect((await previewWorkflow(applyFields)).ok).toBe(false);
    prismaMock.matter.findUnique.mockResolvedValue({ id: "m-1" });
    prismaMock.workflowTemplateVersion.findUnique.mockResolvedValue(null);
    expect(await previewWorkflow({ ...applyFields, templateVersionId: "forged" })).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("refuses a stale (superseded) or archived template version", async () => {
    mockVersion({ latest: 2 });
    expect((await previewWorkflow(applyFields)) as { error: string }).toMatchObject({ ok: false, error: expect.stringMatching(/changed/) });
    mockVersion({ status: "ARCHIVED" });
    expect((await previewWorkflow(applyFields)).ok).toBe(false);
  });

  it("previews resolved assignees and leaves a no-access user unassigned", async () => {
    const result = await previewWorkflow(applyFields);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.items.map((i) => [i.stepId, i.assignee.userId])).toEqual([
      ["step-task", "u-att"],
      ["step-event", null],
    ]);
    expect(result.data.items[1]!.assignee.note).toMatch(/can't access/);
  });
});

describe("applyWorkflow", () => {
  it("creates the application, tasks and events in one transaction; audit holds counts only", async () => {
    const result = await applyWorkflow({ error: null }, fd(applyFields));
    expect(result).toEqual({ error: null, applicationId: "app-1" });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.workflowApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matterId: "m-1", templateVersionId: "ver-1", requestKey: "req-key-0001", anchorDate: new Date("2026-03-06T00:00:00Z") }),
    });
    expect(txMock.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dueDate: new Date("2026-03-08T00:00:00Z"), assignedToId: "u-att", workflowApplicationId: "app-1", workflowStepId: "step-task" }),
    });
    // Event lands on 2026-03-08 (spring-forward day) at 10:00 EDT, unassigned (outsider has no access).
    expect(txMock.calendarEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matterId: "m-1",
        startTime: new Date("2026-03-08T14:00:00Z"),
        endTime: new Date("2026-03-08T14:45:00Z"),
        attendees: { create: [] },
        workflowApplicationId: "app-1",
      }),
    });
    expect(prismaMock.task.create).not.toHaveBeenCalled();
    const audit = JSON.stringify(txMock.auditEvent.create.mock.calls);
    expect(audit).toContain('"tasks":1');
    expect(audit).not.toContain("Privileged");
    expect(audit).not.toContain("Fictional:");
  });

  it("a retried submission with the same request key returns the original application without duplicating", async () => {
    prismaMock.workflowApplication.findUnique.mockResolvedValue({ id: "app-1", matterId: "m-1" });
    expect(await applyWorkflow({ error: null }, fd(applyFields))).toEqual({ error: null, applicationId: "app-1", duplicate: true });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("a request key from another matter can't be used to probe it", async () => {
    prismaMock.workflowApplication.findUnique.mockResolvedValue({ id: "app-x", matterId: "m-other" });
    expect((await applyWorkflow({ error: null }, fd(applyFields))).error).toBe(NOT_FOUND);
  });

  it("a deliberate second application (new key, same template and anchor) creates a new checklist", async () => {
    await applyWorkflow({ error: null }, fd(applyFields));
    txMock.workflowApplication.create.mockResolvedValue({ id: "app-2" });
    const second = await applyWorkflow({ error: null }, fd({ ...applyFields, requestKey: "req-key-0002" }));
    expect(second).toEqual({ error: null, applicationId: "app-2" });
    expect(txMock.task.create).toHaveBeenCalledTimes(2);
  });

  it("losing a concurrent race on the unique request key returns the winner", async () => {
    prismaMock.workflowApplication.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "app-winner", matterId: "m-1" });
    prismaMock.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" }));
    expect(await applyWorkflow({ error: null }, fd(applyFields))).toEqual({ error: null, applicationId: "app-winner", duplicate: true });
  });

  it("a failing step aborts the whole transaction and reports that nothing was created", async () => {
    txMock.calendarEvent.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "t" }));
    const result = await applyWorkflow({ error: null }, fd(applyFields));
    expect(result.error).toMatch(/nothing was created/);
    expect(result.applicationId).toBeUndefined();
    // All writes went through the transaction client, so the database rolls them back together.
    expect(prismaMock.task.create).not.toHaveBeenCalled();
    expect(prismaMock.workflowApplication.create).not.toHaveBeenCalled();
  });

  it("re-checks authorization at apply time (preview is never trusted)", async () => {
    requireCurrentUserMock.mockResolvedValue(staff);
    expect((await applyWorkflow({ error: null }, fd(applyFields))).error).toBe(NOT_FOUND);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("recalculateWorkflow", () => {
  const future = new Date(Date.now() + 30 * 86_400_000);
  const past = new Date(Date.now() - 30 * 86_400_000);
  const application = {
    id: "app-1",
    matterId: "m-1",
    timeZone: "America/New_York",
    tasks: [
      { id: "t-open", title: "Open", status: "OPEN", dueDate: new Date("2026-03-08T00:00:00Z"), workflowStep: taskStep },
      { id: "t-done", title: "Done", status: "DONE", dueDate: new Date("2026-03-08T00:00:00Z"), workflowStep: taskStep },
    ],
    events: [
      { id: "e-future", title: "Future", status: "SCHEDULED", startTime: future, workflowStep: eventStep },
      { id: "e-past", title: "Past", status: "SCHEDULED", startTime: past, workflowStep: eventStep },
      { id: "e-cancelled", title: "Cancelled", status: "CANCELLED", startTime: future, workflowStep: eventStep },
    ],
  };

  beforeEach(() => {
    prismaMock.workflowApplication.findUnique.mockResolvedValue(application);
    txMock.calendarEvent.findUniqueOrThrow.mockResolvedValue({ startTime: future, endTime: new Date(future.getTime() + 45 * 60_000) });
  });

  it("requires an explicit confirmation", async () => {
    expect((await recalculateWorkflow({ error: null }, fd({ applicationId: "app-1", anchorDate: "2026-04-01" }))).error).toMatch(/confirm/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("moves only open tasks and future scheduled events; never deadlines", async () => {
    const result = await recalculateWorkflow({ error: null }, fd({ applicationId: "app-1", anchorDate: "2026-04-01", confirm: "on" }));
    expect(result.error).toBeNull();
    expect(txMock.task.update).toHaveBeenCalledTimes(1);
    expect(txMock.task.update).toHaveBeenCalledWith({ where: { id: "t-open" }, data: { dueDate: new Date("2026-04-03T00:00:00Z") } });
    expect(txMock.calendarEvent.update).toHaveBeenCalledTimes(1);
    expect(txMock.calendarEvent.update.mock.calls[0]![0].where).toEqual({ id: "e-future" });
    expect(JSON.stringify(txMock.auditEvent.create.mock.calls[0]![0].data.metadata)).toBe('{"recalculated":true,"moved":2,"skipped":3}');
    expect("deadline" in prismaMock).toBe(false);
  });

  it("denies users who can't apply workflows on that matter", async () => {
    requireCurrentUserMock.mockResolvedValue(staff);
    expect((await recalculateWorkflow({ error: null }, fd({ applicationId: "app-1", anchorDate: "2026-04-01", confirm: "on" }))).error).toBe(NOT_FOUND);
  });
});
