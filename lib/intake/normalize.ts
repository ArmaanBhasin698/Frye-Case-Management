import { z } from "zod";

import type { NormalizeIntakeResult } from "@/lib/intake/types";

/**
 * Zod shape of a raw Loop/HighLevel contact webhook payload. The contact
 * identifier and name fields accept two conventions rather than one,
 * because a live read-only call against the real HighLevel contacts API
 * (see docs/INTEGRATION_ARCHITECTURE.md) confirmed two things this
 * schema previously assumed wrong: the real contact resource's id field
 * is `id`, not `contactId`, and `firstName`/`lastName` can genuinely be
 * absent on a real contact that only has a combined `contactName`. The
 * *webhook delivery's* exact body shape is still unverified — that
 * requires a real Workflow webhook firing at this endpoint, which this
 * codebase has never received — so both conventions are accepted rather
 * than guessing which one a real delivery will use.
 *
 * Permissive on unrecognized/extra fields (tags, customFields, locationId,
 * etc. are all ignored — this app maps only what `Client` has a place
 * for); strict on the handful of fields Frye actually needs.
 */
const rawIntakePayloadSchema = z.object({
  // Optional: validated when present (webhook deliveries send it), but
  // never read downstream — kept only so lib/intake/highlevelSync.ts can
  // reuse this exact validator for a raw REST contact object (which has
  // no such field) without a parallel schema (see lib/intake/README.md).
  type: z.enum(["ContactCreate", "ContactUpdate"]).optional(),
  contactId: z.string().trim().min(1).optional(),
  id: z.string().trim().min(1).optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  /** Fallback split into firstName/lastName when the discrete fields are absent — see the live-verified finding above. */
  contactName: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().max(200).email().optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional(),
  dateAdded: z.string().trim().min(1),
});

/** `"Jordan Ellis"` -> `{firstName: "Jordan", lastName: "Ellis"}`; a single word has no splittable last name. */
function splitContactName(name: string): { firstName: string; lastName: string } | null {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

/**
 * Normalizes one raw Loop/HighLevel-shaped payload, or explains why it
 * can't be. Never throws — a webhook endpoint needs a value it can always
 * respond to, and a malformed/incomplete lead is an expected, non-
 * exceptional outcome (a partially-filled intake form, a webhook test
 * ping, a future field HighLevel added that this app doesn't understand
 * yet), not a bug.
 */
export function normalizeIntakeLead(raw: unknown): NormalizeIntakeResult {
  const parsed = rawIntakePayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "malformed", detail: parsed.error.issues[0]?.message ?? "Invalid payload shape." };
  }
  const data = parsed.data;

  const externalContactId = data.contactId ?? data.id;
  if (!externalContactId) {
    return { ok: false, reason: "malformed", detail: "Missing a contact identifier (contactId or id)." };
  }

  let firstName = data.firstName;
  let lastName = data.lastName;
  if ((!firstName || !lastName) && data.contactName) {
    const split = splitContactName(data.contactName);
    firstName = firstName ?? split?.firstName;
    lastName = lastName ?? split?.lastName;
  }
  if (!firstName || !lastName) {
    return { ok: false, reason: "malformed", detail: "Missing firstName/lastName (and no splittable contactName)." };
  }

  const receivedAt = new Date(data.dateAdded);
  if (Number.isNaN(receivedAt.getTime())) {
    return { ok: false, reason: "malformed", detail: "dateAdded is not a valid date." };
  }

  return {
    ok: true,
    lead: {
      externalContactId,
      firstName,
      lastName,
      email: data.email && data.email.length > 0 ? data.email : undefined,
      phone: data.phone && data.phone.length > 0 ? data.phone : undefined,
      receivedAt,
    },
  };
}
