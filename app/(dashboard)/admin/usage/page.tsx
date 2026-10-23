import Link from "next/link";
import { format } from "date-fns";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { ACTIVITY_EVENT_TYPES, getUsageReport, parseUsageFilters } from "@/lib/usage/queries";
import { ESTIMATE_LABEL, formatMinutes } from "@/lib/usage/estimate";
import { USAGE_MODULES } from "@/lib/usage/sanitize";
import { expireStaleSessions } from "@/lib/usage/sessions";
import {
  countPurgeableUsage,
  isRetentionHoldActive,
  PURGE_CONFIRMATION_PHRASE,
  USAGE_RETENTION_DAYS,
} from "@/lib/usage/retention";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PurgeUsageForm } from "./purge-form";

function label(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
}

/**
 * Staff usage & utilization — ADMIN only (employee-monitoring data). Every
 * duration derived from activity heartbeats is labelled an estimate and is
 * kept visually separate from recorded work time (TimeEntry).
 */
export default async function AdminUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  assertIsAdmin(user);

  // Lazily close sessions not seen within the JWT lifetime.
  await expireStaleSessions();

  const filters = parseUsageFilters(await searchParams);
  const [report, matters, purgeable] = await Promise.all([
    getUsageReport(filters),
    prisma.matter.findMany({ select: { id: true, caseNumber: true }, orderBy: { caseNumber: "asc" } }),
    countPurgeableUsage(),
  ]);
  const hold = isRetentionHoldActive();
  const maxDaily = Math.max(1, ...report.daily.map((d) => d.activeMinutes));
  const pdfQuery = (userId: string) => `userId=${userId}&from=${filters.fromDay}&to=${filters.toDay}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Usage &amp; Reports</h1>
          <p className="text-sm text-muted-foreground">
            Staff application usage, {filters.fromDay} to {filters.toDay}. Active times are{" "}
            <strong>estimates</strong> ({ESTIMATE_LABEL.toLowerCase()}); recorded work time comes only from time
            entries.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/security">Security monitoring</Link>
        </Button>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div className="space-y-1">
          <Label htmlFor="usage-from" className="text-xs">From</Label>
          <Input id="usage-from" name="from" type="date" defaultValue={filters.fromDay} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="usage-to" className="text-xs">To</Label>
          <Input id="usage-to" name="to" type="date" defaultValue={filters.toDay} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="usage-user" className="text-xs">Staff member</Label>
          <Select id="usage-user" name="userId" defaultValue={filters.userId ?? ""} className="w-44">
            <option value="">All staff</option>
            {report.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="usage-matter" className="text-xs">Matter</Label>
          <Select id="usage-matter" name="matterId" defaultValue={filters.matterId ?? ""} className="w-40">
            <option value="">All matters</option>
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.caseNumber}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="usage-type" className="text-xs">Activity type</Label>
          <Select id="usage-type" name="type" defaultValue={filters.type ?? ""} className="w-44">
            <option value="">Any type</option>
            {ACTIVITY_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="usage-module" className="text-xs">Module</Label>
          <Select id="usage-module" name="module" defaultValue={filters.module ?? ""} className="w-36">
            <option value="">Any module</option>
            {[...USAGE_MODULES, "other"].map((m) => (
              <option key={m} value={m}>
                {label(m)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" size="sm">Apply</Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/usage">Reset</Link>
        </Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Staff utilization</CardTitle>
          <CardDescription>Estimated active application time vs. recorded matter work time.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff member</TableHead>
                <TableHead>Logins</TableHead>
                <TableHead>Est. active time</TableHead>
                <TableHead>Recorded work time</TableHead>
                <TableHead className="text-right">Report</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.perUser.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <span className="font-medium">{u.name}</span>{" "}
                    <span className="text-xs text-muted-foreground">{label(u.role)}</span>
                  </TableCell>
                  <TableCell>{u.logins}</TableCell>
                  <TableCell>~{formatMinutes(u.estimatedActiveMinutes)}</TableCell>
                  <TableCell>{formatMinutes(u.recordedWorkMinutes)}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/reports/pdf/employee-activity?${pdfQuery(u.id)}`}
                      className="text-sm text-primary hover:underline"
                    >
                      Employee activity PDF
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {report.perUser.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No recorded usage in this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage over time</CardTitle>
          <CardDescription>Estimated active minutes and logins per day (Eastern time).</CardDescription>
        </CardHeader>
        <CardContent>
          {report.daily.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity in this period.</p>
          ) : (
            <ul className="space-y-1.5">
              {report.daily.map((d) => (
                <li key={d.day} className="grid grid-cols-[6.5rem_1fr_7rem] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{d.day}</span>
                  <span className="h-2.5 rounded-full bg-muted" aria-hidden>
                    <span
                      className="block h-2.5 rounded-full bg-primary"
                      style={{ width: `${(d.activeMinutes / maxDaily) * 100}%` }}
                    />
                  </span>
                  <span className="text-right text-muted-foreground">
                    ~{formatMinutes(d.activeMinutes)} · {d.logins} login{d.logins === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Login history</CardTitle>
            <CardDescription>Successful sign-ins and failed attempts (from the security center&apos;s records).</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {report.loginHistory.map((l) => (
                <li key={`${l.outcome}-${l.id}`} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{l.user}</span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {format(l.at, "MMM d, h:mm a")}
                    <Badge variant={l.outcome === "Success" ? "success" : "destructive"}>{l.outcome}</Badge>
                  </span>
                </li>
              ))}
              {report.loginHistory.length === 0 && <li className="py-2 text-muted-foreground">No logins in this period.</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent sessions</CardTitle>
            <CardDescription>Session length is wall-clock; active time is estimated.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {report.sessions.map((s) => (
                <li key={s.id} className="py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{s.user}</span>
                    <span className="text-muted-foreground">{format(s.startedAt, "MMM d, h:mm a")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Last activity {format(s.lastSeenAt, "MMM d, h:mm a")} ·{" "}
                    {s.endedAt ? `Ended (${label(s.endReason ?? "UNKNOWN")})` : "Open"} · Length{" "}
                    {formatMinutes(s.durationMinutes)} · Est. active ~{formatMinutes(s.estimatedActiveMinutes)}
                  </p>
                </li>
              ))}
              {report.sessions.length === 0 && <li className="py-2 text-muted-foreground">No sessions in this period.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Modules accessed</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {report.modules.map((m) => (
                <li key={m.module} className="flex justify-between py-1.5">
                  <span>{label(m.module)}</span>
                  <span className="text-muted-foreground">
                    ~{formatMinutes(m.minutes)} active · {m.events} events
                  </span>
                </li>
              ))}
              {report.modules.length === 0 && <li className="py-2 text-muted-foreground">No module activity.</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Matters accessed</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {report.matters.map((m) => (
                <li key={m.matterId} className="flex justify-between py-1.5">
                  <Link href={`/matters/${m.matterId}`} className="hover:underline">
                    {m.caseNumber}
                  </Link>
                  <span className="text-muted-foreground">
                    {m.views} views · ~{formatMinutes(m.minutes)} focused
                  </span>
                </li>
              ))}
              {report.matters.length === 0 && <li className="py-2 text-muted-foreground">No matter activity.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Significant actions</CardTitle>
          <CardDescription>Downloads, exports, access denials, and session events. Identifiers only — no content.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Module / resource</TableHead>
                <TableHead>Matter</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.actions.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-sm text-muted-foreground">{format(a.occurredAt, "MMM d, h:mm a")}</TableCell>
                  <TableCell className="text-sm">{a.user}</TableCell>
                  <TableCell>
                    <Badge variant={a.result === "SUCCESS" ? "outline" : "destructive"}>{label(a.type)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {[a.module, a.resourceType].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.caseNumber ?? "—"}</TableCell>
                </TableRow>
              ))}
              {report.actions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No significant actions in this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data changes</CardTitle>
          <CardDescription>From the audit trail — action and record type only.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border text-sm">
            {report.dataChanges.map((d) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>
                  {d.user} · {label(d.action)} {d.entityType}
                  {d.caseNumber ? ` · ${d.caseNumber}` : ""}
                </span>
                <span className="text-muted-foreground">{format(d.occurredAt, "MMM d, h:mm a")}</span>
              </li>
            ))}
            {report.dataChanges.length === 0 && <li className="py-2 text-muted-foreground">No data changes in this period.</li>}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retention</CardTitle>
          <CardDescription>
            Usage analytics are kept {USAGE_RETENTION_DAYS} days and are never deleted automatically. Audit, security,
            and time records are not affected by this purge.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Older than {purgeable.cutoff.toISOString().slice(0, 10)}: {purgeable.events} events, {purgeable.minutes}{" "}
            activity minutes, {purgeable.sessions} ended sessions.
          </p>
          {hold && (
            <p className="font-medium text-amber-800">
              A preservation hold (USAGE_RETENTION_HOLD) is active — purging is disabled.
            </p>
          )}
          <PurgeUsageForm confirmPhrase={PURGE_CONFIRMATION_PHRASE} disabled={hold} />
        </CardContent>
      </Card>
    </div>
  );
}
