"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateSecurityIncidentStatus } from "@/lib/security/actions";
import type { AdminSecurityIncidentSummary } from "@/lib/security/queries";

const STATUS_VARIANT: Record<AdminSecurityIncidentSummary["status"], "warning" | "secondary" | "success" | "outline"> = {
  OPEN: "warning",
  INVESTIGATING: "secondary",
  RESOLVED: "success",
  FALSE_POSITIVE: "outline",
};

const NEXT_STATUS_OPTIONS: Record<AdminSecurityIncidentSummary["status"], AdminSecurityIncidentSummary["status"][]> = {
  OPEN: ["INVESTIGATING", "FALSE_POSITIVE"],
  INVESTIGATING: ["RESOLVED", "FALSE_POSITIVE"],
  RESOLVED: [],
  FALSE_POSITIVE: [],
};

function statusLabel(status: string) {
  return status
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

export function IncidentRow({ incident }: { incident: AdminSecurityIncidentSummary }) {
  const [error, action, pending] = useActionState(updateSecurityIncidentStatus, undefined);
  const nextOptions = NEXT_STATUS_OPTIONS[incident.status];

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">Suspicious login activity</p>
          <p className="text-xs text-muted-foreground">
            {incident.account ? `${incident.account.name} (${incident.account.email})` : "Unknown account"} —{" "}
            {incident.failedAttemptCount} failed attempts, {incident.windowStart.toLocaleString()} –{" "}
            {incident.windowEnd.toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{incident.severity}</Badge>
          <Badge variant={STATUS_VARIANT[incident.status]}>{statusLabel(incident.status)}</Badge>
        </div>
      </div>

      {nextOptions.length > 0 && (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="incidentId" value={incident.id} />
          {nextOptions.map((next) => (
            <Button key={next} type="submit" name="nextStatus" value={next} size="sm" variant="outline" disabled={pending}>
              Mark {statusLabel(next)}
            </Button>
          ))}
        </form>
      )}

      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
