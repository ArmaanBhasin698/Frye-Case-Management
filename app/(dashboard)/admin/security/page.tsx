import Link from "next/link";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSecurityActivitySummary } from "@/lib/usage/queries";
import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { listSecurityIncidentsForAdmin } from "@/lib/security/queries";
import { SUSPICIOUS_LOGIN_THRESHOLD, SUSPICIOUS_LOGIN_WINDOW_MS } from "@/lib/security/detection";
import { IncidentRow } from "./incident-row";

export default async function AdminSecurityPage() {
  const currentAdmin = await requireCurrentUser();
  assertIsAdmin(currentAdmin);

  const [incidents, activity] = await Promise.all([listSecurityIncidentsForAdmin(), getSecurityActivitySummary()]);
  const windowMinutes = SUSPICIOUS_LOGIN_WINDOW_MS / 60_000;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-serif text-2xl font-semibold text-foreground">Security monitoring</h1>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/usage">Usage &amp; activity</Link>
          </Button>
        </div>
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

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Failed-login patterns</CardTitle>
            <CardDescription>Attempts per email, last 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {activity.failedByEmail.map((f) => (
                <li key={f.email} className="flex justify-between gap-2 py-1.5">
                  <span className="truncate">{f.email}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {f.attempts} attempt{f.attempts === 1 ? "" : "s"}
                    {f.lastAttempt ? ` · last ${format(f.lastAttempt, "MMM d, h:mm a")}` : ""}
                  </span>
                </li>
              ))}
              {activity.failedByEmail.length === 0 && <li className="py-2 text-muted-foreground">No failed logins.</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Unauthorized access attempts</CardTitle>
            <CardDescription>Denied matter and file requests, last 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {activity.denials.map((d) => (
                <li key={d.id} className="flex justify-between gap-2 py-1.5">
                  <span>
                    {d.user?.name ?? "Unknown user"} · {d.resourceType ?? d.module ?? "resource"}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{format(d.occurredAt, "MMM d, h:mm a")}</span>
                </li>
              ))}
              {activity.denials.length === 0 && <li className="py-2 text-muted-foreground">No denied requests.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
