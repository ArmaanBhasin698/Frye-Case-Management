import Link from "next/link";
import { format } from "date-fns";

import { listMatters, type MatterListView } from "@/lib/matters/queries";
import {
  asCalendarDate,
  formatClientName,
  matterStatusLabel,
  matterStatusVariant,
  matterTitle,
} from "@/lib/matters/format";
import { requireCurrentUser } from "@/lib/auth/session";
import { canManageClientsAndMatters } from "@/lib/auth/authorization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Active/Archived toggle — the simplest UI pattern consistent with this
 * app's other list pages (a couple of query-param-driven links, same as
 * every firm-wide filter bar's "Clear filters" link), rather than a full
 * filter-bar component for a single binary choice. `listMatters`'s `view`
 * option (lib/matters/queries.ts) already defaults to "active," so
 * archived Matters never appear here unless explicitly requested.
 */
export default async function MattersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const view: MatterListView = readParam(params.archived) === "1" ? "archived" : "active";

  const matters = await listMatters(user, { view });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Matters</h1>
          <p className="text-sm text-muted-foreground">
            {matters.length} {matters.length === 1 ? "matter" : "matters"}
            {view === "archived" ? " archived." : " on file."}
          </p>
        </div>
        {canManageClientsAndMatters(user) && (
          <Button size="sm" asChild>
            <Link href="/matters/new">New Matter</Link>
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <Button variant={view === "active" ? "default" : "outline"} size="sm" asChild>
          <Link href="/matters">Active</Link>
        </Button>
        <Button variant={view === "archived" ? "default" : "outline"} size="sm" asChild>
          <Link href="/matters?archived=1">Archived</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {matters.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {view === "archived" ? "No archived matters." : "No active matters on file."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Matter</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Court</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matters.map((matter) => (
                  <TableRow key={matter.id} className="cursor-pointer">
                    <TableCell>
                      <Link href={`/matters/${matter.id}`} className="block">
                        <div className="font-medium text-foreground hover:underline">
                          {matterTitle(matter)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {matter.caseNumber} &middot; {matter.charges}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/matters/${matter.id}`}>{formatClientName(matter.client)}</Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{matter.court}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={matterStatusVariant(matter.status)}>
                          {matterStatusLabel(matter.status)}
                        </Badge>
                        {matter.archived && <Badge variant="secondary">Archived</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {matter.assignments.map((a) => a.user.name).join(", ") || "Unassigned"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(asCalendarDate(matter.openedDate), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
