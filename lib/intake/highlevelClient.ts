import { readHighLevelConfig } from "@/lib/intake/config";

const BASE_URL = "https://services.leadconnectorhq.com";
/** HighLevel's API version header — see docs/INTEGRATION_ARCHITECTURE.md for how this was confirmed against a live call. */
const API_VERSION = "2021-07-28";

export class HighLevelApiError extends Error {
  constructor(public readonly status: number) {
    super(`HighLevel API request failed (status ${status}).`);
    this.name = "HighLevelApiError";
  }
}

/** Enough to debug from a server log — never the token or the raw response body. */
function describeHighLevelError(status: number, body: unknown): string {
  const message =
    body && typeof body === "object" && "message" in body ? String((body as { message?: unknown }).message) : undefined;
  return `status=${status}${message ? ` (${message})` : ""}`;
}

async function highLevelRequest(path: string, searchParams: Record<string, string> = {}): Promise<unknown> {
  const config = readHighLevelConfig();
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.privateIntegrationToken}`,
      Version: API_VERSION,
    },
  });

  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    console.error("[highlevelClient] request failed", describeHighLevelError(response.status, body));
    throw new HighLevelApiError(response.status);
  }
  return body;
}

/**
 * Read-only contact listing for the configured Location, capped at
 * `limit`. Used only for one-off live schema verification (see
 * docs/INTEGRATION_ARCHITECTURE.md) — the runtime intake path
 * (lib/intake/ingest.ts) never calls this; it works entirely from the
 * webhook payload HighLevel already sends.
 */
export async function listContactsForConfiguredLocation(limit: number): Promise<unknown> {
  const config = readHighLevelConfig();
  return highLevelRequest("/contacts/", { locationId: config.locationId, limit: String(limit) });
}

/** One page of GET /contacts/ — shape confirmed against a live call, see docs/INTEGRATION_ARCHITECTURE.md. */
export type ContactsPage = {
  contacts: unknown[];
  meta: {
    startAfter?: number;
    startAfterId?: string;
    nextPage?: number | null;
  };
};

function isContactsPage(body: unknown): body is ContactsPage {
  if (!body || typeof body !== "object") return false;
  const b = body as { contacts?: unknown; meta?: unknown };
  return Array.isArray(b.contacts) && typeof b.meta === "object" && b.meta !== null;
}

/**
 * One page of contacts for the configured Location, sorted newest-`dateAdded`-first
 * (HighLevel's confirmed default order for this endpoint — no sort/filter
 * query parameter is sent or assumed). Pass `after` (from a previous
 * page's `meta`) to continue a walk; omit it to start at page 1. Throws
 * `HighLevelMalformedResponseError` if the response doesn't have the
 * expected `contacts`/`meta` shape, so callers can treat that as its own
 * distinct, safe-to-stop-on failure category.
 */
export class HighLevelMalformedResponseError extends Error {
  constructor() {
    super("HighLevel contacts response did not have the expected shape.");
    this.name = "HighLevelMalformedResponseError";
  }
}

export async function fetchContactsPage(
  limit: number,
  after?: { startAfter: number; startAfterId: string },
): Promise<ContactsPage> {
  const config = readHighLevelConfig();
  const searchParams: Record<string, string> = { locationId: config.locationId, limit: String(limit) };
  if (after) {
    searchParams.startAfter = String(after.startAfter);
    searchParams.startAfterId = after.startAfterId;
  }
  const body = await highLevelRequest("/contacts/", searchParams);
  if (!isContactsPage(body)) {
    throw new HighLevelMalformedResponseError();
  }
  return body;
}
