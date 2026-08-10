import Link from "next/link";
import { format } from "date-fns";
import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import type { CallDirection } from "@prisma/client";

import { getFirmWideCalls, type FirmCallFilters, type FirmCallSort } from "@/lib/communications/queries";
import { listMatters } from "@/lib/matters/queries";
import { canManageClientsAndMatters } from "@/lib/auth/authorization";
import { formatCallDuration, formatClientName, matterTitle } from "@/lib/matters/format";
import { requireCurrentUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CommunicationsFilterBar,
  type CommunicationsFilterValues,
} from "@/components/shared/communications-filter-bar";
import { LogCallForm } from "@/components/shared/log-call-form";

const DIRECTION_VALUES = new Set<CallDirection>(["INBOUND", "OUTBOUND"]);
const FILED_STATE_VALUES = new Set(["filed", "unfiled"]);

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Firm-wide Communications (app/(dashboard)/communications) — a real,
 * authenticated Calls-first aggregate view over the existing `Call` model,
 * the first thing this long-disabled sidebar item has ever been enabled
 * for (see docs/ROADMAP.md, Phase 5). No Vonage integration exists yet:
 * every row here is a manually logged/seeded Call, and this page is
 * exactly the internal surface a future telephony sync would populate
 * without any UI rewrite (see lib/matters/actions.ts#createCall).
 *
 * Visibility (see lib/communications/queries.ts for the full rule): filed
 * calls are scoped to matters the caller may access, same as firm-wide
 * Tasks/Calendar. Unfiled calls carry no assignment/ownership of their own
 * to scope by, so they're only shown to ADMIN/ATTORNEY — the same
 * conservative role gate `canManageClientsAndMatters` already uses for
 * "no assignment to check" scenarios elsewhere in this app, chosen instead
 * of exposing every unfiled call's phone numbers/notes to every
 * authenticated user firm-wide.
 */
export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;

  const directionParam = readParam(params.direction);
  const filedStateParam = readParam(params.filedState);
  const matterId = readParam(params.matterId) || "";
  const sortParam = readParam(params.sort);

  const direction =
    directionParam && DIRECTION_VALUES.has(directionParam as CallDirection)
      ? (directionParam as CallDirection)
      : undefined;
  const filedState =
    filedStateParam && FILED_STATE_VALUES.has(filedStateParam)
      ? (filedStateParam as "filed" | "unfiled")
      : undefined;
  const sort: FirmCallSort = sortParam === "oldest" ? "oldest" : "recent";

  const mayViewUnfiled = canManageClientsAndMatters(user);
  const filters: FirmCallFilters = {
    matterId: matterId || undefined,
    direction,
    filedState: mayViewUnfiled ? filedState : undefined,
  };

  const [calls, matters] = await Promise.all([getFirmWideCalls(user, filters, sort), listMatters(user)]);

  const currentFilters: CommunicationsFilterValues = {
    matterId,
    direction: direction ?? "",
    filedState: mayViewUnfiled ? (filedState ?? "") : "",
    sort,
  };

  const matterOptions = matters.map((m) => ({ id: m.id, label: `${matterTitle(m)} · ${m.caseNumber}` }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Communications</h1>
          <p className="text-sm text-muted-foreground">
            Firm-wide calls across every matter you have access to — an aggregate view over each
            matter&apos;s own Calls tab, not a separate record. {calls.length}{" "}
            {calls.length === 1 ? "call" : "calls"} match these filters.
          </p>
        </div>
        <LogCallForm matters={matterOptions} />
      </div>

      <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Vonage is not connected yet — every call below is manually logged (see docs/ROADMAP.md,
        Phase 6 for the planned integration).
        {!mayViewUnfiled && (
          <>
            {" "}
            Unfiled calls (not yet attached to a matter) aren&apos;t shown here for your role —
            see a matter&apos;s own Calls tab, or ask an Attorney/Admin, to file one to your
            matter.
          </>
        )}
      </div>

      <CommunicationsFilterBar
        basePath="/communications"
        current={currentFilters}
        matters={matterOptions}
        canFilterUnfiled={mayViewUnfiled}
      />

      <Card>
        <CardContent className="p-0">
          {calls.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No calls match these filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Numbers</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Matter</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => {
                  const DirectionIcon = call.direction === "INBOUND" ? PhoneIncoming : PhoneOutgoing;
                  return (
                    <TableRow key={call.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {format(call.occurredAt, "MMM d, yyyy 'at' h:mm a")}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm text-foreground">
                          <DirectionIcon className="h-4 w-4 text-muted-foreground" />
                          {call.direction === "INBOUND" ? "Inbound" : "Outbound"}
                        </span>
                        {call.flagged && (
                          <Badge variant="warning" className="mt-1">
                            Flagged
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {call.fromNumber} &rarr; {call.toNumber}
                        {call.contactName && (
                          <div className="text-xs text-muted-foreground">{call.contactName}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatCallDuration(call.durationSeconds)}
                      </TableCell>
                      <TableCell>
                        {call.matter ? (
                          <>
                            <Link
                              href={`/matters/${call.matter.id}`}
                              className="text-sm text-foreground hover:underline"
                            >
                              {matterTitle(call.matter)}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {formatClientName(call.matter.client)}
                            </div>
                          </>
                        ) : (
                          <Badge variant="outline">Unfiled</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {call.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
