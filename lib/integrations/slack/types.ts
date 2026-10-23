/**
 * Slack integration boundary — design types only. Nothing in the app calls
 * Slack; built-in Team Chat (lib/chat/) never depends on any of this. A
 * future, explicitly authorized connection implements `SlackProvider` and
 * adds persistence for the mappings below at that time (no tables exist
 * yet, deliberately — see docs/INTEGRATION_ARCHITECTURE.md).
 */

export type SlackConnectionState = "NOT_CONFIGURED" | "CONFIGURED_NOT_CONNECTED" | "CONNECTED" | "ERROR";

export type SlackConnectionStatus = {
  state: SlackConnectionState;
  /** Human-readable, never includes a credential value. */
  detail: string;
  missingSettings: string[];
};

/** One Slack workspace ↔ the firm. */
export type SlackWorkspaceMapping = { slackTeamId: string; slackTeamName: string; connectedById: string; connectedAt: Date };

/** A Frye staff account ↔ its Slack user, for attribution and DMs. */
export type SlackUserMapping = { userId: string; slackUserId: string };

/** A Frye channel ↔ a Slack channel. Never created automatically. */
export type SlackChannelMapping = { conversationId: string; slackChannelId: string; direction: "TO_SLACK" | "FROM_SLACK" | "BOTH" };

/**
 * A matter ↔ a Slack channel. Future sync must re-check matter access for
 * every recipient and must never forward privileged matter messages
 * without explicit, per-channel configuration.
 */
export type SlackMatterChannelAssociation = { matterId: string; slackChannelId: string; configuredById: string };

/** Notification payload: ids and a short, non-privileged summary only. */
export type SlackNotification = { slackChannelId: string; summary: string; deepLinkPath?: string };

export interface SlackProvider {
  getConnectionStatus(): SlackConnectionStatus;
  /** Start of OAuth. Throws SlackNotConfiguredError until a connection is authorized. */
  buildOAuthUrl(state: string): string;
  mapWorkspace(mapping: SlackWorkspaceMapping): Promise<void>;
  mapUser(mapping: SlackUserMapping): Promise<void>;
  mapChannel(mapping: SlackChannelMapping): Promise<void>;
  linkMatterChannel(association: SlackMatterChannelAssociation): Promise<void>;
  sendNotification(notification: SlackNotification): Promise<void>;
}

export class SlackNotConfiguredError extends Error {
  constructor(message = "Slack is not connected. No Slack connection has been authorized for this firm.") {
    super(message);
    this.name = "SlackNotConfiguredError";
  }
}
