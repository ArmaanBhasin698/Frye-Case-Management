import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readHighLevelWebhookSecretMock, ingestHighLevelContactEventMock } = vi.hoisted(() => ({
  readHighLevelWebhookSecretMock: vi.fn(),
  ingestHighLevelContactEventMock: vi.fn(),
}));

vi.mock("@/lib/intake/config", () => ({ readHighLevelWebhookSecret: readHighLevelWebhookSecretMock }));
vi.mock("@/lib/intake/ingest", () => ({ ingestHighLevelContactEvent: ingestHighLevelContactEventMock }));

const { POST } = await import("@/app/api/intake/highlevel/route");

const SECRET = "fictional-webhook-secret-value";

function postRequest(body: unknown, authorization?: string) {
  return new NextRequest("http://localhost/api/intake/highlevel", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  readHighLevelWebhookSecretMock.mockReturnValue(SECRET);
});

describe("POST /api/intake/highlevel", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await POST(postRequest({ type: "ContactCreate" }));

    expect(response.status).toBe(401);
    expect(ingestHighLevelContactEventMock).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong secret", async () => {
    const response = await POST(postRequest({ type: "ContactCreate" }, "Bearer wrong-secret-value"));

    expect(response.status).toBe(401);
    expect(ingestHighLevelContactEventMock).not.toHaveBeenCalled();
  });

  it("accepts a correctly authenticated, well-formed payload and delegates to ingestHighLevelContactEvent", async () => {
    ingestHighLevelContactEventMock.mockResolvedValue({ outcome: "recorded", intakeLeadId: "lead-1", created: true });

    const payload = { type: "ContactCreate", contactId: "fictional-contact-0001" };
    const response = await POST(postRequest(payload, `Bearer ${SECRET}`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ received: true, outcome: "recorded" });
    expect(ingestHighLevelContactEventMock).toHaveBeenCalledWith(payload);
  });

  it("still returns 200 for a malformed/ignored payload — a webhook sender should not be told to retry a permanent rejection", async () => {
    ingestHighLevelContactEventMock.mockResolvedValue({ outcome: "ignored", reason: "malformed", detail: "x" });

    const response = await POST(postRequest({ nonsense: true }, `Bearer ${SECRET}`));

    expect(response.status).toBe(200);
  });

  it("returns 200 (not an error) for a body that isn't valid JSON at all", async () => {
    const request = new NextRequest("http://localhost/api/intake/highlevel", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: "not json {{{",
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(ingestHighLevelContactEventMock).not.toHaveBeenCalled();
  });

  it("returns 500 without leaking the underlying error when ingest throws unexpectedly", async () => {
    ingestHighLevelContactEventMock.mockRejectedValue(new Error("db connection lost"));

    const response = await POST(postRequest({ type: "ContactCreate" }, `Bearer ${SECRET}`));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain("db connection lost");
  });

  it("returns 500 without leaking anything when the webhook secret isn't configured", async () => {
    readHighLevelWebhookSecretMock.mockImplementation(() => {
      throw new Error("HIGHLEVEL_WEBHOOK_SECRET must be set");
    });

    const response = await POST(postRequest({ type: "ContactCreate" }, `Bearer ${SECRET}`));

    expect(response.status).toBe(500);
    expect(ingestHighLevelContactEventMock).not.toHaveBeenCalled();
  });
});
