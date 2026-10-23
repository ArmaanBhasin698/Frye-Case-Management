import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({ prismaMock: { userActivityEvent: { create: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const { buildActivityData, recordActivity } = await import("@/lib/usage/record");
const { matterIdFromPath, moduleForPath, sanitizePath } = await import("@/lib/usage/sanitize");

beforeEach(() => vi.clearAllMocks());

describe("sanitizePath", () => {
  it("drops query strings and fragments, which can carry names and search terms", () => {
    expect(sanitizePath("/contacts?q=Jane%20Doe&category=WITNESS#top")).toBe("/contacts");
  });

  it("collapses record ids so paths aggregate and don't identify records", () => {
    expect(sanitizePath("/matters/cmvl6fd9v000e7dhe9i8pdyow/documents/files/cmvl6fdca00407dhed22tjpqt")).toBe(
      "/matters/:id/documents/files/:id",
    );
  });

  it("strips unexpected characters and caps length", () => {
    expect(sanitizePath("/reports/<script>")).toBe("/reports/script");
    expect(sanitizePath(`/${"a".repeat(30)}/`.repeat(20))!.length).toBeLessThanOrEqual(200);
  });

  it("returns null for empty input", () => {
    expect(sanitizePath(null)).toBeNull();
    expect(sanitizePath("")).toBeNull();
  });
});

describe("moduleForPath / matterIdFromPath", () => {
  it("maps paths to modules", () => {
    expect(moduleForPath("/")).toBe("dashboard");
    expect(moduleForPath("/matters/abc/notes")).toBe("matters");
    expect(moduleForPath("/admin/usage")).toBe("admin");
    expect(moduleForPath("/somewhere-else")).toBe("other");
  });

  it("extracts a matter id but not the New Matter page", () => {
    expect(matterIdFromPath("/matters/m-123/tasks")).toBe("m-123");
    expect(matterIdFromPath("/matters/new")).toBeNull();
    expect(matterIdFromPath("/contacts")).toBeNull();
  });
});

describe("buildActivityData", () => {
  it("keeps only identifier-shaped values — free text never reaches the database", () => {
    const data = buildActivityData({
      userId: "u1",
      type: "DOCUMENT_DOWNLOAD",
      path: "/matters/cmvl6fd9v000e7dhe9i8pdyow/documents?q=privileged strategy",
      resourceType: "Document",
      resourceId: "Client admitted everything in the memo",
      matterId: "m1",
    });
    expect(data).toEqual({
      userId: "u1",
      sessionId: null,
      type: "DOCUMENT_DOWNLOAD",
      module: "matters",
      path: "/matters/:id/documents",
      matterId: "m1",
      resourceType: "Document",
      resourceId: null,
      result: "SUCCESS",
    });
    expect(JSON.stringify(data)).not.toContain("privileged");
  });
});

describe("recordActivity", () => {
  it("never throws into the caller when the write fails", async () => {
    prismaMock.userActivityEvent.create.mockRejectedValue(new Error("db down"));
    await expect(recordActivity({ userId: "u1", type: "MATTER_VIEW" })).resolves.toBe(false);
  });

  it("writes the sanitized event", async () => {
    prismaMock.userActivityEvent.create.mockResolvedValue({});
    await expect(recordActivity({ userId: "u1", type: "REPORT_EXPORT", path: "/reports/pdf/x?from=2026" })).resolves.toBe(true);
    expect(prismaMock.userActivityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "REPORT_EXPORT", path: "/reports/pdf/x", module: "reports" }),
    });
  });
});
