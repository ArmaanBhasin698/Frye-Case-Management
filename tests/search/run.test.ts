import { beforeEach, describe, expect, it, vi } from "vitest";

const MODELS = [
  "matter",
  "client",
  "contact",
  "task",
  "document",
  "timeEntry",
  "note",
  "chatMessage",
  "judicialRuling",
  "professionalObservation",
] as const;

const { prismaMock, getAssignedMatterIdsMock, hasMatterAccessMock, readableConversationIdsMock } = vi.hoisted(() => {
  const models = [
    "matter",
    "client",
    "contact",
    "task",
    "document",
    "timeEntry",
    "note",
    "chatMessage",
    "judicialRuling",
    "professionalObservation",
  ];
  const prisma: Record<string, { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> }> = {};
  for (const m of models) prisma[m] = { count: vi.fn(), findMany: vi.fn() };
  return {
    prismaMock: prisma,
    getAssignedMatterIdsMock: vi.fn(),
    hasMatterAccessMock: vi.fn(),
    readableConversationIdsMock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/access", () => ({ getAssignedMatterIds: getAssignedMatterIdsMock, hasMatterAccess: hasMatterAccessMock }));
vi.mock("@/lib/contacts/visibility", () => ({
  contactVisibilityFilterFor: vi.fn(async (u: { role: string }) => (u.role === "ADMIN" ? {} : { VISIBLE: true })),
}));
vi.mock("@/lib/chat/access", () => ({ readableConversationIds: readableConversationIdsMock }));

const { runGlobalSearch, collectSearchResults } = await import("@/lib/search");
const { parseSearchParams } = await import("@/lib/search/params");

const admin = { id: "u-admin", role: "ADMIN" as const };
const attorney = { id: "u-att", role: "ATTORNEY" as const };
const paralegal = { id: "u-para", role: "PARALEGAL" as const };
const staff = { id: "u-staff", role: "STAFF" as const };

function p(extra: Record<string, string> = {}) {
  const r = parseSearchParams({ q: "ellis", ...extra });
  if (!r.ok) throw new Error("bad");
  return r.params;
}

const whereOf = (model: string, call = 0) => JSON.stringify(prismaMock[model]!.count.mock.calls[call]?.[0]?.where);

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of MODELS) {
    prismaMock[m]!.count.mockResolvedValue(0);
    prismaMock[m]!.findMany.mockResolvedValue([]);
  }
  getAssignedMatterIdsMock.mockResolvedValue(["m1"]);
  hasMatterAccessMock.mockResolvedValue(true);
  readableConversationIdsMock.mockResolvedValue(["conv-1"]);
});

describe("runGlobalSearch", () => {
  it("returns nothing — and runs no queries — for a matter filter the user can't access", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    const out = await runGlobalSearch(attorney, p({ matterId: "m-secret" }));
    expect(out).toEqual({ results: [], matterFilterDenied: true });
    for (const m of MODELS) expect(prismaMock[m]!.count).not.toHaveBeenCalled();
  });

  it("omits clients for PARALEGAL/STAFF and includes them for ATTORNEY/ADMIN", async () => {
    for (const user of [paralegal, staff]) {
      vi.clearAllMocks();
      for (const m of MODELS) prismaMock[m]!.count.mockResolvedValue(0);
      getAssignedMatterIdsMock.mockResolvedValue([]);
      readableConversationIdsMock.mockResolvedValue([]);
      const out = await runGlobalSearch(user, p());
      expect(out.results.map((r) => r.type)).not.toContain("clients");
      expect(prismaMock.client!.count).not.toHaveBeenCalled();
    }
    const out = await runGlobalSearch(attorney, p());
    expect(out.results.map((r) => r.type)).toContain("clients");
  });

  it("scopes an unassigned user to no matters and no conversations", async () => {
    getAssignedMatterIdsMock.mockResolvedValue([]);
    readableConversationIdsMock.mockResolvedValue([]);
    await runGlobalSearch(staff, p());
    expect(whereOf("note")).toContain(JSON.stringify({ matterId: { in: [] } }));
    expect(whereOf("chatMessage")).toContain(JSON.stringify({ conversationId: { in: [] } }));
    expect(whereOf("matter")).toContain(JSON.stringify({ id: { in: [] } }));
  });

  it("a revoked chat membership / matter access drops the conversation from the readable list used in the query", async () => {
    readableConversationIdsMock.mockResolvedValue(["conv-still-ok"]);
    await runGlobalSearch(attorney, p({ type: "chat" }));
    expect(whereOf("chatMessage")).toContain(JSON.stringify({ conversationId: { in: ["conv-still-ok"] } }));
    expect(whereOf("chatMessage")).not.toContain("conv-1");
  });

  it("admins search every matter without an id restriction", async () => {
    await runGlobalSearch(admin, p({ type: "notes" }));
    expect(getAssignedMatterIdsMock).not.toHaveBeenCalled();
    expect(whereOf("note")).not.toContain('"matterId":{"in"');
  });

  it("counts and pages with the same scoped where (counts never include hidden rows)", async () => {
    prismaMock.note!.count.mockResolvedValue(3);
    prismaMock.note!.findMany.mockResolvedValue([
      { id: "n1", body: "Ellis called back", createdAt: new Date("2026-01-01"), matterId: "m1", matter: { id: "m1", caseNumber: "CN-1", client: { lastName: "Ellis" } }, author: { name: "A" } },
    ]);
    const out = await runGlobalSearch(attorney, p({ type: "notes" }));
    const countWhere = prismaMock.note!.count.mock.calls[0]![0].where;
    const findWhere = prismaMock.note!.findMany.mock.calls[0]![0].where;
    expect(findWhere).toEqual(countWhere);
    expect(out.results[0]).toMatchObject({ type: "notes", total: 3 });
    expect(out.results[0]!.items[0]!.snippet).toContain("Ellis");
  });

  it("orders exact primary-field matches first with stable id tie-breaks", async () => {
    prismaMock.matter!.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
    await runGlobalSearch(attorney, p({ type: "matters", q: "24-CR-1" }));
    const [exactCall, restCall] = prismaMock.matter!.findMany.mock.calls;
    expect(JSON.stringify(exactCall![0].where)).toContain('"equals":"24-CR-1"');
    expect(JSON.stringify(restCall![0].where)).toContain('"NOT"');
    expect(exactCall![0]).toMatchObject({ skip: 0, take: 1 });
    expect(restCall![0]).toMatchObject({ skip: 0, take: 24 });
    expect(restCall![0].orderBy).toEqual([{ openedDate: "desc" }, { id: "asc" }]);
  });

  it("previews 5 per type without a type filter, and paginates 25 with one", async () => {
    prismaMock.task!.count.mockResolvedValue(60);
    await runGlobalSearch(attorney, p());
    expect(prismaMock.task!.findMany.mock.calls.some((c) => c[0].take === 5)).toBe(true);
    vi.clearAllMocks();
    // 60 matches in total, none of them exact → page 3 is rows 50–59 of the partial segment.
    prismaMock.task!.count.mockResolvedValueOnce(60).mockResolvedValueOnce(0);
    prismaMock.task!.findMany.mockResolvedValue([]);
    getAssignedMatterIdsMock.mockResolvedValue(["m1"]);
    readableConversationIdsMock.mockResolvedValue([]);
    await runGlobalSearch(attorney, p({ type: "tasks", page: "3" }));
    expect(prismaMock.task!.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.task!.findMany.mock.calls[0]![0]).toMatchObject({ skip: 50, take: 25 });
  });

  it("collectSearchResults uses the same scope and refuses forged matter filters", async () => {
    hasMatterAccessMock.mockResolvedValue(false);
    expect(await collectSearchResults(attorney, p({ matterId: "m-x" }), 100)).toEqual([]);
  });
});
