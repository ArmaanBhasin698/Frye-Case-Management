import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { listSecurityIncidentsForAdmin } from "@/lib/security/queries";
import { SUSPICIOUS_LOGIN_THRESHOLD, SUSPICIOUS_LOGIN_WINDOW_MS } from "@/lib/security/detection";
import { IncidentRow } from "./incident-row";

export default async function AdminSecurityPage() {
  const currentAdmin = await requireCurrentUser();
  assertIsAdmin(currentAdmin);

  const incidents = await listSecurityIncidentsForAdmin();
  const windowMinutes = SUSPICIOUS_LOGIN_WINDOW_MS / 60_000;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">Security monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Suspicious-authentication events, detected automatically at {SUSPICIOUS_LOGIN_THRESHOLD} failed logins for
          the same account within {windowMinutes} minutes — a configurable demonstration rule, not an
          industry-standard threshold.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Incidents</CardTitle>
          <CardDescription>Open → Investigating → Resolved / False Positive.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No suspicious authentication activity detected.</p>
          ) : (
            incidents.map((incident) => <IncidentRow key={incident.id} incident={incident} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
