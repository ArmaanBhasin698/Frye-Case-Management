/** Fails closed: the cron endpoint refuses to run without a configured secret. */
export function readNotificationsCronSecret(): string {
  const secret = process.env.NOTIFICATIONS_CRON_SECRET?.trim();
  if (!secret) {
    throw new Error("NOTIFICATIONS_CRON_SECRET must be set to run the notification scheduler endpoint — see .env.example.");
  }
  return secret;
}
