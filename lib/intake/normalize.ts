import { z } from "zod";

import type { NormalizeIntakeResult } from "@/lib/intake/types";

/**
 * Zod shape of a raw Loop/HighLevel contact webhook payload
 * (`type`, `contactId`, `firstName`, `lastName`, `email`, `phone`,
 * `dateAdded`), written from HighLevel's public webhook documentation —
 * **never verified against a live payload**, since this codebase has never
 * received a real one. Treat as best-effort until a real sandbox event
 * proves otherwise (see docs/INTEGRATION_ARCHITECTURE.md).
 *
 * Permissive on unrecognized/extra fields (tags, customFields, locationId,
 * etc. are all ignored — this app maps only what `Client` has a place
 * for); strict on the handful of fields Frye actually needs.
 */
const rawIntakePayloadSchema = z.object({
  type: z.enum(["ContactCreate", "ContactUpdate"]),
  contactId: z.string().trim().min(1),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().max(200).email().optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional(),
  dateAdded: z.string().trim().min(1),
});

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

  const receivedAt = new Date(data.dateAdded);
  if (Number.isNaN(receivedAt.getTime())) {
    return { ok: false, reason: "malformed", detail: "dateAdded is not a valid date." };
  }

  return {
    ok: true,
    lead: {
      externalContactId: data.contactId,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email && data.email.length > 0 ? data.email : undefined,
      phone: data.phone && data.phone.length > 0 ? data.phone : undefined,
      receivedAt,
    },
  };
}
