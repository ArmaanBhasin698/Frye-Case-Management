import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchContactsPage,
  HighLevelApiError,
  HighLevelMalformedResponseError,
} from "@/lib/intake/highlevelClient";

const ENV_KEYS = ["HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN", "HIGHLEVEL_LOCATION_ID"] as const;
let savedEnv: Record<string, string | undefined>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN = "fictional-token-value";
  process.env.HIGHLEVEL_LOCATION_ID = "fictional-location-id";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) };
}

describe("fetchContactsPage", () => {
  it("requests page 1 with locationId + limit, no cursor params, when no `after` is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ contacts: [], meta: {} }));

    await fetchContactsPage(100);

    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.pathname).toBe("/contacts/");
    expect(calledUrl.searchParams.get("locationId")).toBe("fictional-location-id");
    expect(calledUrl.searchParams.get("limit")).toBe("100");
    expect(calledUrl.searchParams.has("startAfter")).toBe(false);
    expect(calledUrl.searchParams.has("startAfterId")).toBe(false);
  });

  it("includes the cursor params when `after` is given, to continue a walk", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ contacts: [], meta: {} }));

    await fetchContactsPage(100, { startAfter: 12345, startAfterId: "contact-9" });

    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get("startAfter")).toBe("12345");
    expect(calledUrl.searchParams.get("startAfterId")).toBe("contact-9");
  });

  it("never puts the token in the URL — only in the Authorization header", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ contacts: [], meta: {} }));

    await fetchContactsPage(100);

    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).not.toContain("fictional-token-value");
    const headers = fetchMock.mock.calls[0]![1].headers;
    expect(headers.Authorization).toBe("Bearer fictional-token-value");
  });

  it("returns the parsed page on a well-shaped response", async () => {
    const body = { contacts: [{ id: "c1" }], meta: { startAfter: 1, startAfterId: "c1", nextPage: 2 } };
    fetchMock.mockResolvedValue(jsonResponse(body));

    const result = await fetchContactsPage(100);

    expect(result).toEqual(body);
  });

  it("throws HighLevelMalformedResponseError when `contacts` is missing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ meta: {} }));

    await expect(fetchContactsPage(100)).rejects.toBeInstanceOf(HighLevelMalformedResponseError);
  });

  it("throws HighLevelMalformedResponseError when `meta` is missing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ contacts: [] }));

    await expect(fetchContactsPage(100)).rejects.toBeInstanceOf(HighLevelMalformedResponseError);
  });

  it("throws HighLevelApiError carrying the status on a non-2xx response, never the raw body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "invalid_access_token" }, false, 401));

    let thrown: unknown;
    try {
      await fetchContactsPage(100);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HighLevelApiError);
    expect((thrown as HighLevelApiError).status).toBe(401);
    expect((thrown as Error).message).not.toContain("invalid_access_token");
  });

  it("throws HighLevelApiError with status 429 on a rate-limited response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 429));

    await expect(fetchContactsPage(100)).rejects.toMatchObject({ status: 429 });
  });
});
