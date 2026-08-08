import Link from "next/link";
import { format } from "date-fns";

import { listMatters } from "@/lib/matters/queries";
import { formatClientName, matterStatusLabel, matterStatusVariant, matterTitle } from "@/lib/matters/format";
import { requireCurrentUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function MattersPage() {
  const user = await requireCurrentUser();
  const matters = await listMatters(user);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Matters</h1>
        <p className="text-sm text-muted-foreground">
          {matters.length} {matters.length === 1 ? "matter" : "matters"} on file.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
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
                    <Badge variant={matterStatusVariant(matter.status)}>
                      {matterStatusLabel(matter.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {matter.assignments.map((a) => a.user.name).join(", ") || "Unassigned"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(matter.openedDate, "MMM d, yyyy")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
