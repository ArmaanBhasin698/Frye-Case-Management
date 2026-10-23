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
import { prisma } from "@/lib/db";
import { listStages } from "@/lib/stages/queries";
import { buildMatterCustomFieldFilter, parseOptions } from "@/lib/custom-fields/values";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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
  const stageParam = readParam(params.stage) ?? "";
  const fieldParam = readParam(params.cf) ?? "";
  const fieldValue = (readParam(params.cfv) ?? "").slice(0, 200);

  const [stages, fieldDefs] = await Promise.all([
    listStages({ includeArchived: true }),
    prisma.customFieldDefinition.findMany({
      where: { entity: "MATTER", type: { in: ["SINGLE_SELECT", "BOOLEAN", "SHORT_TEXT"] } },
      orderBy: [{ position: "asc" }, { label: "asc" }],
    }),
  ]);
  // Unknown ids are ignored rather than trusted: a forged stage or field
  // id simply means "no filter", and every filter is ANDed with the
  // caller's matter scope inside listMatters.
  const stageId = stageParam === "none" || stages.some((s) => s.id === stageParam) ? stageParam : "";
  const fieldDef = fieldDefs.find((d) => d.id === fieldParam);
  const extraWhere = fieldDef ? (buildMatterCustomFieldFilter(fieldDef, fieldValue) ?? undefined) : undefined;

  const matters = await listMatters(user, { view, stageId: stageId || undefined, extraWhere });

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

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        {view === "archived" && <input type="hidden" name="archived" value="1" />}
        <div className="space-y-1">
          <Label htmlFor="matters-stage" className="text-xs">
            Stage
          </Label>
          <Select id="matters-stage" name="stage" defaultValue={stageId} className="w-48">
            <option value="">Any stage</option>
            <option value="none">No stage</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.archivedAt ? " (archived)" : ""}
              </option>
            ))}
          </Select>
        </div>
        {fieldDefs.length > 0 && (
          <>
            <div className="space-y-1">
              <Label htmlFor="matters-cf" className="text-xs">
                Custom field
              </Label>
              <Select id="matters-cf" name="cf" defaultValue={fieldDef?.id ?? ""} className="w-48">
                <option value="">Any</option>
                {fieldDefs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="matters-cfv" className="text-xs">
                Equals
              </Label>
              {fieldDef?.type === "SINGLE_SELECT" ? (
                <Select id="matters-cfv" name="cfv" defaultValue={fieldValue} className="w-48">
                  <option value="">Any value</option>
                  {parseOptions(fieldDef.options).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                      {o.archived ? " (retired)" : ""}
                    </option>
                  ))}
                </Select>
              ) : fieldDef?.type === "BOOLEAN" ? (
                <Select id="matters-cfv" name="cfv" defaultValue={fieldValue} className="w-32">
                  <option value="">Any</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              ) : (
                <Input id="matters-cfv" name="cfv" defaultValue={fieldValue} maxLength={200} className="w-48" placeholder="Exact value" />
              )}
            </div>
          </>
        )}
        <Button type="submit" size="sm">
          Apply
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={view === "archived" ? "/matters?archived=1" : "/matters"}>Clear</Link>
        </Button>
      </form>

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
                  <TableHead>Stage</TableHead>
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
                      {matter.stage ? `${matter.stage.name}${matter.stage.archivedAt ? " (archived)" : ""}` : "—"}
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
