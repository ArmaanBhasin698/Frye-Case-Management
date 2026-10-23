import type { MeetingProvider } from "@prisma/client";

/**
 * Manually entered virtual-meeting links. No meeting is ever created with a
 * provider's API; we only validate and recognize a URL someone pasted, so
 * a link works immediately without any credentials or integration.
 */

export const MEETING_URL_MAX_LENGTH = 2_000;

export const MEETING_PROVIDER_LABELS: Record<MeetingProvider, string> = {
  ZOOM: "Zoom",
  MICROSOFT_TEAMS: "Microsoft Teams",
  GOOGLE_MEET: "Google Meet",
  WEBEX: "Webex",
  OTHER: "Meeting link",
};

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectMeetingProvider(url: URL): MeetingProvider {
  const host = url.hostname.toLowerCase();
  if (hostMatches(host, "zoom.us") || hostMatches(host, "zoomgov.com")) return "ZOOM";
  if (hostMatches(host, "teams.microsoft.com") || hostMatches(host, "teams.live.com")) return "MICROSOFT_TEAMS";
  if (host === "meet.google.com") return "GOOGLE_MEET";
  if (hostMatches(host, "webex.com")) return "WEBEX";
  return "OTHER";
}

export type MeetingUrlResult = { ok: true; url: string; provider: MeetingProvider } | { ok: false; error: string };

/**
 * HTTPS only (never javascript:, data:, http:, or any scheme that could run
 * code or carry a meeting over plaintext), no embedded credentials, a real
 * dotted hostname, and a length cap. The normalized `URL.href` is what's
 * stored and later rendered as a link.
 */
export function validateMeetingUrl(raw: string): MeetingUrlResult {
  const value = raw.trim();
  if (value.length > MEETING_URL_MAX_LENGTH) return { ok: false, error: "Meeting link is too long." };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Enter a full meeting link starting with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Meeting links must use https://." };
  if (url.username || url.password) return { ok: false, error: "Meeting links can't contain a username or password." };
  if (!url.hostname.includes(".") || url.hostname.endsWith(".")) {
    return { ok: false, error: "Enter a valid meeting link." };
  }
  return { ok: true, url: url.href, provider: detectMeetingProvider(url) };
}
