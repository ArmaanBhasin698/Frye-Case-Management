import {
  SlackNotConfiguredError,
  type SlackConnectionStatus,
  type SlackProvider,
} from "@/lib/integrations/slack/types";

/** Placeholder settings a future connection would need (see .env.example). Values are never read back out. */
export const SLACK_SETTINGS = ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"] as const;

export function readSlackConfigPresence(env: Record<string, string | undefined> = process.env) {
  const missing = SLACK_SETTINGS.filter((key) => !env[key]?.trim());
  return { configured: missing.length === 0, missing: [...missing] };
}

/**
 * The only SlackProvider that exists. It never performs a network call and
 * always reports "not connected" — even when placeholder settings are
 * present, because no Slack connection has been authorized. Every
 * mutating/sending method refuses.
 */
export class DisconnectedSlackProvider implements SlackProvider {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  getConnectionStatus(): SlackConnectionStatus {
    const { configured, missing } = readSlackConfigPresence(this.env);
    return configured
      ? {
          state: "CONFIGURED_NOT_CONNECTED",
          detail: "Settings are present, but no Slack connection has been authorized. Nothing is synchronized.",
          missingSettings: [],
        }
      : {
          state: "NOT_CONFIGURED",
          detail: "Not connected. Slack credentials are not configured.",
          missingSettings: missing,
        };
  }

  buildOAuthUrl(): string {
    throw new SlackNotConfiguredError();
  }

  async mapWorkspace(): Promise<void> {
    throw new SlackNotConfiguredError();
  }

  async mapUser(): Promise<void> {
    throw new SlackNotConfiguredError();
  }

  async mapChannel(): Promise<void> {
    throw new SlackNotConfiguredError();
  }

  async linkMatterChannel(): Promise<void> {
    throw new SlackNotConfiguredError();
  }

  async sendNotification(): Promise<void> {
    throw new SlackNotConfiguredError();
  }
}

export function getSlackProvider(): SlackProvider {
  return new DisconnectedSlackProvider();
}
