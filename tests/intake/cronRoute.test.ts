import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readHighLevelSyncCronSecretMock, runHighLevelContactSyncMock } = vi.hoisted(() => ({
  readHighLevelSyncCronSecretMock: vi.fn(),
  runHighLevelContactSyncMock: vi.fn(),
}));

vi.mock("@/lib/intake/config", () => ({ readHighLevelSyncCronSecret: readHighLevelSyncCronSecretMock }));
vi.mock("@/lib/intake/highlevelSync", () => ({ runHighLevelContactSync: runHighLevelContactSyncMock }));

const { GET } = await import("@/app/api/cron/highlevel-sync/route");

const SECRET = "fictional-cron-secret-value";

function getRequest(authorization?: string) {
  return new NextRequest("http://localhost/api/cron/highlevel-sync", {
    headers: authorization ? { authorization } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  readHighLevelSyncCronSecretMock.mockReturnValue(SECRET);
});

describe("GET /api/cron/highlevel-sync", () => {
  it("fails closed with 500 when the cron secret isn't configured, never falling back to unauthenticated", async () => {
    readHighLevelSyncCronSecretMock.mockImplementation(() => {
      throw new Error("HIGHLEVEL_SYNC_CRON_SECRET must be set");
    });

    const response = await GET(getRequest(`Bearer ${SECRET}`));

    expect(response.status).toBe(500);
    expect(runHighLevelContactSyncMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no Authorization header", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(runHighLevelContactSyncMock).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong secret", async () => {
    const response = await GET(getRequest("Bearer wrong-value"));

    expect(response.status).toBe(401);
    expect(runHighLevelContactSyncMock).not.toHaveBeenCalled();
  });

  it("calls runHighLevelContactSync as a scheduled, unattended trigger and returns its result", async () => {
    runHighLevelContactSyncMock.mockResolvedValue({
      outcome: "completed",
      contactsChecked: 5,
      newLeadsCreated: 2,
      pendingLeadsUpdated: 1,
      linkedOrSkipped: 2,
      failureCount: 0,
      lastRunOutcome: "success",
    });

    const response = await GET(getRequest(`Bearer ${SECRET}`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(runHighLevelContactSyncMock).toHaveBeenCalledWith("scheduled", null);
    expect(json.contactsChecked).toBe(5);
  });

  it("returns 200 with already_running rather than erroring on an overlapping scheduled tick", async () => {
    runHighLevelContactSyncMock.mockResolvedValue({ outcome: "already_running" });

    const response = await GET(getRequest(`Bearer ${SECRET}`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.outcome).toBe("already_running");
  });

  it("returns 500 without leaking the underlying error when the sync throws unexpectedly", async () => {
    runHighLevelContactSyncMock.mockRejectedValue(new Error("db connection lost"));

    const response = await GET(getRequest(`Bearer ${SECRET}`));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain("db connection lost");
  });
});
