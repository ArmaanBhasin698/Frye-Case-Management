import { timingSafeEqual } from "node:crypto";

/**
 * Verifies an `Authorization: Bearer <token>` header against a pre-shared
 * secret, in constant time so response timing can't be used to guess it
 * byte-by-byte. Shared by both HTTP entry points in the intake boundary
 * that have no user session to authenticate instead: the HighLevel webhook
 * (`HIGHLEVEL_WEBHOOK_SECRET`) and the sync cron endpoint
 * (`HIGHLEVEL_SYNC_CRON_SECRET`) — see lib/intake/config.ts. Not a
 * cryptographic payload signature; HighLevel has none available for a
 * Private Integration (see .env.example), and the cron endpoint has no
 * HighLevel payload to sign in the first place.
 */
export function isAuthorizedBearerToken(authorizationHeader: string | null, expectedSecret: string): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }
  const provided = authorizationHeader.slice("Bearer ".length).trim();
  if (provided.length === 0) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expectedSecret);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}
