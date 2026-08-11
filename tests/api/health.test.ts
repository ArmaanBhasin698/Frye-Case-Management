import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRawMock } = vi.hoisted(() => ({ queryRawMock: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: queryRawMock } }));

const { GET } = await import("@/app/api/health/route");

beforeEach(() => {
  queryRawMock.mockReset();
});

describe("GET /api/health", () => {
  it("reports ok with a 200 when the database is reachable", async () => {
    queryRawMock.mockResolvedValueOnce([{ "?column?": 1 }]);
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", db: "ok" });
  });

  it("reports degraded with a 503 when the database is unreachable, without leaking the error", async () => {
    queryRawMock.mockRejectedValueOnce(new Error("connection refused to postgres://user:pass@host:5432/db"));
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "degraded", db: "unreachable" });
    expect(JSON.stringify(body)).not.toContain("postgres://");
  });

  it("never returns keys beyond status/db", async () => {
    queryRawMock.mockResolvedValueOnce([]);
    const response = await GET();
    const body = await response.json();

    expect(Object.keys(body).sort()).toEqual(["db", "status"]);
  });
});
