/**
 * HighLevel connection configuration for the Loop/HighLevel intake
 * boundary (see lib/intake/README.md). Kept separate from
 * normalize.ts/linking.ts, mirroring lib/storage/config.ts's separation
 * of "how do we connect" from "what do we do once connected" — so this is
 * independently unit-testable without ever making a live HighLevel call.
 *
 * Config only: nothing here calls the HighLevel API. Chosen auth method
 * is a Private Integration Token scoped to one Location (HighLevel's term
 * for a sub-account) — this is an internal, single-sub-account
 * integration, not a public OAuth app.
 */

export type HighLevelConfig = {
  privateIntegrationToken: string;
  locationId: string;
};

/**
 * Validates the HighLevel environment configuration and returns it, or
 * throws a clear error naming exactly which variables are missing. The
 * error message never includes a variable's value — only which ones are
 * unset — so it's safe to surface in a server log or a boot-time crash
 * without risking a leaked secret.
 */
export function readHighLevelConfig(): HighLevelConfig {
  const privateIntegrationToken = process.env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN?.trim();
  const locationId = process.env.HIGHLEVEL_LOCATION_ID?.trim();

  const missing = [
    !privateIntegrationToken && "HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN",
    !locationId && "HIGHLEVEL_LOCATION_ID",
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    throw new Error(
      `HighLevel integration requires ${missing.join(", ")} to be set — see .env.example.`,
    );
  }

  return { privateIntegrationToken: privateIntegrationToken!, locationId: locationId! };
}

/**
 * The pre-shared secret HighLevel's Workflow "Custom Webhook" action sends
 * as a Bearer token (see app/api/intake/highlevel/route.ts and
 * lib/intake/webhookAuth.ts). Separate from `HighLevelConfig` above — this
 * secures an *inbound* delivery, not an outbound API call, and the two are
 * rotated independently. HighLevel has no native cryptographic webhook
 * signature for a Private Integration (that's a Marketplace-App-only
 * feature — see .env.example) — this shared secret is the verification
 * mechanism this integration actually uses.
 */
export function readHighLevelWebhookSecret(): string {
  const secret = process.env.HIGHLEVEL_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("HIGHLEVEL_WEBHOOK_SECRET must be set to receive HighLevel intake webhooks — see .env.example.");
  }
  return secret;
}

/**
 * Pre-shared secret for the scheduled/cron sync entry point (see
 * app/api/cron/highlevel-sync/route.ts and lib/intake/highlevelSync.ts).
 * Deliberately fails closed: with no deployment scheduler chosen yet (see
 * docs/ARCHITECTURE.md), an unconfigured secret must never fall back to
 * "unauthenticated" — it must refuse every request instead.
 */
export function readHighLevelSyncCronSecret(): string {
  const secret = process.env.HIGHLEVEL_SYNC_CRON_SECRET?.trim();
  if (!secret) {
    throw new Error("HIGHLEVEL_SYNC_CRON_SECRET must be set to run the HighLevel sync cron endpoint — see .env.example.");
  }
  return secret;
}
