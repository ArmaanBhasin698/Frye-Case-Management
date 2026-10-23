import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { getSlackProvider, SLACK_SETTINGS } from "@/lib/integrations/slack/provider";

const PLANNED_CAPABILITIES = [
  "Workspace connection via Slack OAuth (requires explicit firm authorization first)",
  "Staff ↔ Slack user identity mapping",
  "Opt-in mapping of individual Frye channels to Slack channels",
  "Matter-channel associations that re-check matter access for every recipient",
  "Non-privileged notifications (e.g. “new message in a channel you follow”) with links back into Frye",
  "Connection health and integration error reporting",
];

/**
 * ADMIN-only integration settings. Slack is scaffolding only: the status
 * shown comes from DisconnectedSlackProvider, which never makes a network
 * call. There are deliberately no connect or sync controls.
 */
export default async function AdminIntegrationsPage() {
  const user = await requireCurrentUser();
  assertIsAdmin(user);
  const status = getSlackProvider().getConnectionStatus();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">Integrations</h1>
        <p className="text-sm text-muted-foreground">Optional external services. Built-in Team Chat works without any of them.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Slack</CardTitle>
            <Badge variant="secondary">
              {status.state === "CONFIGURED_NOT_CONNECTED" ? "Configured, not connected" : "Not connected"}
            </Badge>
          </div>
          <CardDescription>{status.detail}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">Planned capabilities</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              {PLANNED_CAPABILITIES.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium">Configuration requirements</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Explicit authorization from the firm to connect a Slack workspace.</li>
              <li>
                Environment settings: {SLACK_SETTINGS.join(", ")}
                {status.missingSettings.length > 0 && ` (missing: ${status.missingSettings.join(", ")})`}.
              </li>
              <li>A reviewed data-handling policy for what may leave Frye.</li>
            </ul>
          </div>
          <p className="rounded-md border border-border bg-muted/40 p-3">
            Privileged matter messages are never synchronized to Slack automatically. Any future synchronization must be
            configured explicitly, per channel, and must respect matter-level permissions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
