import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("@/lib/notifications/scheduler", () => ({ runNotificationScheduler: runMock }));
vi.mock("@/lib/auth/config", () => ({ auth: (callback: (req: unknown) => unknown) => callback }));

const { GET } = await import("@/app/api/cron/notifications/route");
const proxyModule = await import("@/proxy");

const original = process.env.NOTIFICATIONS_CRON_SECRET;
const request = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/notifications", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTIFICATIONS_CRON_SECRET = "test-secret-value";
  runMock.mockResolvedValue({ status: "completed", planned: 2, created: 1, batches: 1 });
});
afterEach(() => {
  process.env.NOTIFICATIONS_CRON_SECRET = original;
});

describe("cron/notifications route", () => {
  it("fails closed when the secret isn't configured", async () => {
    delete process.env.NOTIFICATIONS_CRON_SECRET;
    expect((await GET(request("Bearer test-secret-value"))).status).toBe(500);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer token", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("runs the scheduler and returns counts only", async () => {
    const response = await GET(request("Bearer test-secret-value"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "completed", planned: 2, created: 1, batches: 1 });
  });

  it("is excluded from the session proxy (it carries its own secret)", () => {
    const [pattern] = proxyModule.config.matcher;
    expect(pattern).toContain("api/cron/notifications");
  });
});
