import type { CallDirection } from "@prisma/client";

/**
 * Provider-neutral shape of a call event, once normalized. Nothing in this
 * module (or anything that consumes it) should ever reference a
 * Vonage-specific field name or payload shape directly — that isolation is
 * the entire point of lib/telephony/normalize.ts. A future SMS/other-
 * provider adapter would normalize into this same shape too.
 *
 * Deliberately mirrors only the columns `Call` (prisma/schema.prisma)
 * actually has, so a real adapter can feed this straight into
 * lib/telephony/ingest.ts without any further translation:
 * - `externalCallId` -> `Call.vonageCallId` (kept as the schema's actual
 *   column name; see docs/INTEGRATION_ARCHITECTURE.md for why this type
 *   uses a provider-neutral name here despite that)
 * - `recordingRef` is an opaque provider pointer (e.g. a Vonage recording
 *   URL/id) used to *retrieve* a recording later — never the audio itself,
 *   and never persisted directly (see lib/telephony/recording.ts).
 */
export type NormalizedCallEvent = {
  externalCallId: string;
  direction: CallDirection;
  fromNumber: string;
  toNumber: string;
  occurredAt: Date;
  durationSeconds: number;
  contactName?: string;
  recordingRef?: string;
};

/**
 * Outcome of normalizing one raw provider event. A rejected/ignored event
 * is not an exception — most call lifecycles emit several events (ringing,
 * answered, completed) and only the terminal one is ingestable — so
 * callers branch on `ok` rather than catching.
 */
export type NormalizeResult =
  | { ok: true; event: NormalizedCallEvent }
  | { ok: false; reason: "malformed"; detail: string }
  | { ok: false; reason: "unsupported_status"; detail: string };
