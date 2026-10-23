import { afterEach, describe, expect, it, vi } from "vitest";

const { requireCurrentUserMock, notFoundMock } = vi.hoisted(() => ({
  requireCurrentUserMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: requireCurrentUserMock }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

const { DisconnectedSlackProvider, readSlackConfigPresence } = await import("@/lib/integrations/slack/provider");
const { SlackNotConfiguredError } = await import("@/lib/integrations/slack/types");
const { default: AdminIntegrationsPage } = await import("@/app/(dashboard)/admin/integrations/page");

const allSet = { SLACK_CLIENT_ID: "placeholder", SLACK_CLIENT_SECRET: "placeholder", SLACK_SIGNING_SECRET: "placeholder" };

afterEach(() => vi.restoreAllMocks());

describe("Slack scaffolding", () => {
  it("reports Not Configured, listing what's missing, when credentials are absent", () => {
    const status = new DisconnectedSlackProvider({}).getConnectionStatus();
    expect(status.state).toBe("NOT_CONFIGURED");
    expect(status.missingSettings).toEqual(["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"]);
  });

  it("still reports not connected even when settings are present — no connection is authorized", () => {
    const status = new DisconnectedSlackProvider(allSet).getConnectionStatus();
    expect(status.state).toBe("CONFIGURED_NOT_CONNECTED");
    expect(JSON.stringify(status)).not.toContain("placeholder");
  });

  it("treats blank values as missing", () => {
    expect(readSlackConfigPresence({ ...allSet, SLACK_SIGNING_SECRET: "  " })).toEqual({
      configured: false,
      missing: ["SLACK_SIGNING_SECRET"],
    });
  });

  it("refuses OAuth, mapping, and notifications, and never touches the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = new DisconnectedSlackProvider(allSet);
    expect(() => provider.buildOAuthUrl()).toThrow(SlackNotConfiguredError);
    await expect(provider.sendNotification()).rejects.toBeInstanceOf(SlackNotConfiguredError);
    await expect(provider.mapUser()).rejects.toBeInstanceOf(SlackNotConfiguredError);
    await expect(provider.mapChannel()).rejects.toBeInstanceOf(SlackNotConfiguredError);
    await expect(provider.mapWorkspace()).rejects.toBeInstanceOf(SlackNotConfiguredError);
    await expect(provider.linkMatterChannel()).rejects.toBeInstanceOf(SlackNotConfiguredError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Admin Integrations page", () => {
  it("is ADMIN-only — every other role gets the standard not-found", async () => {
    for (const role of ["ATTORNEY", "PARALEGAL", "STAFF"] as const) {
      requireCurrentUserMock.mockResolvedValue({ id: "u", role });
      await expect(AdminIntegrationsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("renders for ADMIN without calling the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    requireCurrentUserMock.mockResolvedValue({ id: "a", role: "ADMIN" });
    const page = await AdminIntegrationsPage();
    expect(page).toBeTruthy();
    expect(JSON.stringify(page)).toContain("never synchronized to Slack automatically");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
