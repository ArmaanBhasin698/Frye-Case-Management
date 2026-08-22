import { z } from "zod";

import type { NormalizeResult } from "@/lib/telephony/types";

/**
 * Zod shape of a raw Vonage Voice API call-event webhook payload, as
 * documented by Vonage (conversation_uuid, status, direction, from/to,
 * timestamps, duration, recording_url). **Written from public API
 * documentation, never verified against a live Vonage payload** — this
 * codebase has never received a real Vonage webhook. Treat field names/
 * shapes here as "best effort until a live/sandbox event proves
 * otherwise," not a confirmed contract — see
 * docs/INTEGRATION_ARCHITECTURE.md's Vonage section.
 *
 * Deliberately permissive on unknown/extra fields (Vonage may add more
 * over time) and strict on the fields this app actually needs.
 */
const rawVonageCallEventSchema = z.object({
  conversation_uuid: z.string().trim().min(1),
  status: z.string().trim().min(1),
  direction: z.enum(["inbound", "outbound"]),
  from: z.string().trim().min(1).max(32),
  to: z.string().trim().min(1).max(32),
  // Vonage sends Unix-epoch-seconds-as-string timestamps and a
  // string duration; coerced here rather than trusted as already-numeric.
  start_time: z.string().trim().min(1),
  end_time: z.string().trim().min(1).optional(),
  duration: z.coerce.number().int().min(0).optional(),
  recording_url: z.string().trim().min(1).optional(),
});

/** Statuses that represent a finished call with a real, final duration — the only ones this app ingests as a `Call` row. */
const TERMINAL_COMPLETED_STATUSES = new Set(["completed"]);
/** Recognized but not (yet) ingestable — a call still in progress, or one that never connected. */
const RECOGNIZED_NON_INGESTABLE_STATUSES = new Set([
  "started",
  "ringing",
  "answered",
  "busy",
  "cancelled",
  "failed",
  "rejected",
  "timeout",
  "unanswered",
]);

/**
 * Normalizes one raw Vonage-shaped webhook payload into a
 * `NormalizedCallEvent`, or explains why it wasn't ingestable. Never
 * throws on bad input — a webhook endpoint calling this needs a value it
 * can always safely respond to (typically 200, so the provider doesn't
 * retry-storm a payload Frye will never be able to use), not an exception
 * to catch.
 */
export function normalizeVonageCallEvent(raw: unknown): NormalizeResult {
  const parsed = rawVonageCallEventSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "malformed", detail: parsed.error.issues[0]?.message ?? "Invalid payload shape." };
  }
  const data = parsed.data;

  if (!TERMINAL_COMPLETED_STATUSES.has(data.status)) {
    if (RECOGNIZED_NON_INGESTABLE_STATUSES.has(data.status)) {
      return { ok: false, reason: "unsupported_status", detail: `"${data.status}" is not a terminal call event.` };
    }
    return { ok: false, reason: "malformed", detail: `Unrecognized status "${data.status}".` };
  }

  if (data.duration === undefined) {
    return { ok: false, reason: "malformed", detail: "A completed call must report a duration." };
  }

  const startEpochSeconds = Number(data.start_time);
  if (!Number.isFinite(startEpochSeconds)) {
    return { ok: false, reason: "malformed", detail: "start_time must be a Unix epoch seconds value." };
  }

  return {
    ok: true,
    event: {
      externalCallId: data.conversation_uuid,
      direction: data.direction === "inbound" ? "INBOUND" : "OUTBOUND",
      fromNumber: data.from,
      toNumber: data.to,
      occurredAt: new Date(startEpochSeconds * 1000),
      durationSeconds: data.duration,
      recordingRef: data.recording_url,
    },
  };
}
