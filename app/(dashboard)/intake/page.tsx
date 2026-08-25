import Link from "next/link";
import { format, isToday } from "date-fns";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertCanManageClientsAndMatters } from "@/lib/auth/access";
import { getHighLevelSyncState, listPendingIntakeLeads } from "@/lib/intake/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SyncFromLoopButton } from "@/components/shared/sync-from-loop-button";

/** Same date-fns conventions as the rest of the app (see e.g. app/(dashboard)/matters/[matterId]/timeline/page.tsx) — no separate timezone handling exists anywhere else in this app to reuse, so this doesn't invent one. */
function formatLastSynced(state: Awaited<ReturnType<typeof getHighLevelSyncState>>): string {
  if (!state?.lastSuccessfulSyncAt) {
    return "Never synced";
  }
  const when = isToday(state.lastSuccessfulSyncAt)
    ? `Today at ${format(state.lastSuccessfulSyncAt, "h:mm a")}`
    : format(state.lastSuccessfulSyncAt, "MMM d, yyyy 'at' h:mm a");

  const parts = [`Last synced: ${when}`];
  if (typeof state.newLeadsCreated === "number" && state.newLeadsCreated > 0) {
    parts.push(`${state.newLeadsCreated} new ${state.newLeadsCreated === 1 ? "lead" : "leads"} added`);
  }
  if (typeof state.pendingLeadsUpdated === "number" && state.pendingLeadsUpdated > 0) {
    parts.push(`${state.pendingLeadsUpdated} updated`);
  }
  if (typeof state.linkedOrSkipped === "number" && state.linkedOrSkipped > 0) {
    parts.push(`${state.linkedOrSkipped} linked/skipped`);
  }
  return parts.join(" · ");
}

/**
 * Staff review queue for Loop/HighLevel intake leads awaiting a decision
 * (link to an existing Client, create a new one, or dismiss) — see
 * lib/intake/README.md. Gated the same as the Clients roster: deciding
 * whether a lead becomes a Client is the Client/Matter management role
 * rule, not a narrower matter-assignment check. Production intake is now
 * pull-based (lib/intake/highlevelSync.ts) — this page also surfaces when
 * that last ran and offers a manual "Sync from Loop" trigger.
 */
export default async function IntakePage() {
  const user = await requireCurrentUser();
  assertCanManageClientsAndMatters(user);

  const [leads, syncState] = await Promise.all([listPendingIntakeLeads(), getHighLevelSyncState()]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Intake Review</h1>
          <p className="text-sm text-muted-foreground">
            {leads.length} {leads.length === 1 ? "lead" : "leads"} awaiting review from Loop/HighLevel.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{formatLastSynced(syncState)}</p>
        </div>
        <SyncFromLoopButton />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Provider</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id} className="cursor-pointer">
                  <TableCell>
                    <Link href={`/intake/${lead.id}`} className="font-medium text-foreground hover:underline">
                      {lead.firstName} {lead.lastName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{lead.email ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{lead.phone ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {lead.receivedAt.toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">Loop/HighLevel</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {leads.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No intake leads awaiting review.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
