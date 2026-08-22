/**
 * Fictional, provider-neutral fixtures shaped like Vonage Voice API
 * webhook payloads (see lib/telephony/normalize.ts for the caveat that
 * this shape is written from documentation, not a verified live payload).
 * Every phone number and id here is fictional — never a real number, never
 * a real Vonage conversation id. Used by tests and available for any
 * future manual local exploration of the ingestion path; never sent to or
 * received from Vonage.
 */

const FICTIONAL_FROM = "+15550142000";
const FICTIONAL_TO = "+15550198000";

export const inboundRingingEvent = {
  conversation_uuid: "fictional-conv-inbound-0001",
  status: "ringing",
  direction: "inbound",
  from: FICTIONAL_FROM,
  to: FICTIONAL_TO,
  start_time: "1735689600",
};

export const outboundCompletedEvent = {
  conversation_uuid: "fictional-conv-outbound-0002",
  status: "completed",
  direction: "outbound",
  from: FICTIONAL_TO,
  to: FICTIONAL_FROM,
  start_time: "1735689600",
  end_time: "1735689780",
  duration: 180,
};

export const inboundCompletedWithRecordingEvent = {
  conversation_uuid: "fictional-conv-inbound-0003",
  status: "completed",
  direction: "inbound",
  from: FICTIONAL_FROM,
  to: FICTIONAL_TO,
  start_time: "1735690000",
  end_time: "1735690240",
  duration: 240,
  recording_url: "https://fictional-vonage-recordings.example/fictional-conv-inbound-0003.mp3",
};

/** Same externalCallId (conversation_uuid) as `outboundCompletedEvent` — simulates a retried/duplicated webhook delivery. */
export const duplicateOutboundCompletedEvent = { ...outboundCompletedEvent };

export const malformedMissingFieldsEvent = {
  conversation_uuid: "fictional-conv-malformed-0004",
  status: "completed",
  // direction/from/to/start_time/duration all missing.
};

export const unsupportedStatusEvent = {
  conversation_uuid: "fictional-conv-unsupported-0005",
  status: "busy",
  direction: "outbound",
  from: FICTIONAL_TO,
  to: FICTIONAL_FROM,
  start_time: "1735689600",
};

/** Fictional recording audio bytes — never real audio, just a fixed byte sequence for round-tripping through DocumentStore in tests. */
export const fictionalRecordingBytes = Buffer.from("FICTIONAL-TEST-AUDIO-FIXTURE-NOT-REAL-AUDIO");
