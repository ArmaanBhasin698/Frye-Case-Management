import Link from "next/link";

import { prisma } from "@/lib/db";
import { isAdmin, type AuthorizableUser } from "@/lib/auth/authorization";
import { listAccessibleMatterOptions } from "@/lib/contacts/queries";
import { REPORT_KIND_LABELS, runReport, type ReportFilters, type ReportKind } from "@/lib/reports/saved";
import { TIME_CATEGORY_LABELS, TIME_CATEGORY_VALUES } from "@/lib/time/labels";
import { ACTIVITY_EVENT_TYPES } from "@/lib/usage/queries";
import { SEARCH_TYPES, SEARCH_TYPE_LABELS } from "@/lib/search/params";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SaveReportForm } from "@/components/shared/saved-report-forms";

const DISPLAY_ROWS = 200;

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function SelectField({
  name,
  label,
  value,
  options,
  anyLabel = "Any",
}: {
  name: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
  anyLabel?: string | null;
}) {
  return (
    <Field id={`rf-${name}`} label={label}>
      <Select id={`rf-${name}`} name={name} defaultValue={value ?? ""} className="w-44">
        {anyLabel !== null && <option value="">{anyLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
    </Field>
  );
}

function DateField({ name, label, value }: { name: string; label: string; value?: string }) {
  return (
    <Field id={`rf-${name}`} label={label}>
      <Input id={`rf-${name}`} name={name} type="date" defaultValue={value} className="w-36" />
    </Field>
  );
}

/**
 * Filter form + results for one report kind, run under the CURRENT
 * user's scope. Option lists are themselves scoped (accessible matters);
 * submitting a forged option only narrows results (runReport ANDs scope).
 */
export async function SavedReportRunner({
  user,
  kind,
  filters,
  formAction,
  allowSave,
}: {
  user: AuthorizableUser;
  kind: ReportKind;
  filters: ReportFilters;
  formAction: string;
  allowSave: boolean;
}) {
  const [table, matters, staff, stages, customFields] = await Promise.all([
    runReport(user, kind, filters),
    listAccessibleMatterOptions(user),
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    prisma.matterStage.findMany({ where: { archivedAt: null }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    prisma.customFieldDefinition.findMany({
      where: { entity: "MATTER", archivedAt: null },
      orderBy: { position: "asc" },
      select: { id: true, label: true },
    }),
  ]);
  const matterOptions = matters.map((m) => ({ value: m.id, label: `${m.caseNumber} — ${m.client.lastName}` }));
  const staffOptions = staff.map((s) => ({ value: s.id, label: s.name }));
  const exportHref = `/reports/export/${kind.toLowerCase()}?${new URLSearchParams(filters).toString()}`;

  return (
    <div className="space-y-4">
      <form method="get" action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        {formAction.endsWith("/run") && <input type="hidden" name="kind" value={kind} />}
        {kind === "MATTERS" && (
          <>
            <SelectField name="status" label="Status" value={filters.status} options={["OPEN", "PENDING", "CLOSED"].map((v) => ({ value: v, label: v.toLowerCase() }))} />
            <SelectField name="stageId" label="Stage" value={filters.stageId} options={stages.map((s) => ({ value: s.id, label: s.name }))} />
            <SelectField
              name="archived"
              label="Archive state"
              value={filters.archived ?? "active"}
              anyLabel={null}
              options={[
                { value: "active", label: "Active only" },
                { value: "archived", label: "Archived only" },
                { value: "all", label: "Active + archived" },
              ]}
            />
            <SelectField
              name="attorneyId"
              label="Attorney"
              value={filters.attorneyId}
              options={staff.filter((s) => s.role === "ATTORNEY" || s.role === "ADMIN").map((s) => ({ value: s.id, label: s.name }))}
            />
            <SelectField name="cfDefinitionId" label="Custom field" value={filters.cfDefinitionId} anyLabel="None" options={customFields.map((c) => ({ value: c.id, label: c.label }))} />
            <Field id="rf-cfValue" label="Field equals">
              <Input id="rf-cfValue" name="cfValue" defaultValue={filters.cfValue} maxLength={200} className="w-40" placeholder="value or option" />
            </Field>
          </>
        )}
        {kind === "TASKS" && (
          <>
            <SelectField name="status" label="Status" value={filters.status} options={["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"].map((v) => ({ value: v, label: v.toLowerCase().replace("_", " ") }))} />
            <SelectField name="priority" label="Priority" value={filters.priority} options={["LOW", "NORMAL", "HIGH"].map((v) => ({ value: v, label: v.toLowerCase() }))} />
            <SelectField name="assigneeId" label="Assignee" value={filters.assigneeId} options={staffOptions} />
            <SelectField name="matterId" label="Matter" value={filters.matterId} options={matterOptions} />
            <DateField name="dueFrom" label="Due from" value={filters.dueFrom} />
            <DateField name="dueTo" label="Due to" value={filters.dueTo} />
          </>
        )}
        {kind === "TIME" && (
          <>
            <DateField name="from" label="From" value={filters.from} />
            <DateField name="to" label="To" value={filters.to} />
            <SelectField name="matterId" label="Matter" value={filters.matterId} options={matterOptions} />
            <SelectField name="userId" label="Staff" value={filters.userId} options={staffOptions} />
            <SelectField name="category" label="Category" value={filters.category} options={TIME_CATEGORY_VALUES.map((c) => ({ value: c, label: TIME_CATEGORY_LABELS[c] }))} />
            <SelectField name="billable" label="Billable" value={filters.billable} options={[{ value: "yes", label: "Billable" }, { value: "no", label: "Nonbillable" }]} />
          </>
        )}
        {kind === "USAGE" && (
          <>
            <DateField name="from" label="From" value={filters.from} />
            <DateField name="to" label="To" value={filters.to} />
            <SelectField name="userId" label="Staff" value={filters.userId} options={staffOptions} />
            <SelectField name="type" label="Event" value={filters.type} options={ACTIVITY_EVENT_TYPES.map((t) => ({ value: t, label: t.toLowerCase().replace(/_/g, " ") }))} />
          </>
        )}
        {kind === "SEARCH" && (
          <>
            <Field id="rf-q" label="Search text">
              <Input id="rf-q" name="q" defaultValue={filters.q} minLength={2} maxLength={100} required className="w-56" />
            </Field>
            <SelectField name="type" label="Type" value={filters.type} anyLabel="All types" options={SEARCH_TYPES.map((t) => ({ value: t, label: SEARCH_TYPE_LABELS[t] }))} />
            <SelectField name="matterId" label="Matter" value={filters.matterId} options={matterOptions} />
            <DateField name="from" label="From" value={filters.from} />
            <DateField name="to" label="To" value={filters.to} />
          </>
        )}
        <Button type="submit" size="sm">Run</Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {table
            ? `${table.rows.length}${table.truncated ? "+" : ""} row${table.rows.length === 1 ? "" : "s"} — ${REPORT_KIND_LABELS[kind]}, scoped to what you can access right now.`
            : "This report type isn't available to you."}
          {kind === "TIME" && !isAdmin(user) && " Rates and amounts are shown to administrators only."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {allowSave && table && <SaveReportForm kind={kind} filters={filters} />}
          {table && (
            <Button variant="outline" size="sm" asChild>
              <Link href={exportHref}>Export CSV</Link>
            </Button>
          )}
        </div>
      </div>

      {table && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {table.columns.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.slice(0, DISPLAY_ROWS).map((row, i) => (
                  <TableRow key={i}>
                    {row.map((cell, j) => (
                      <TableCell key={j} className="max-w-xs truncate text-sm">
                        {cell instanceof Date ? cell.toISOString().replace("T", " ").slice(0, 16) : cell === true ? "Yes" : cell === false ? "No" : String(cell ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {table.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={table.columns.length} className="py-6 text-center text-sm text-muted-foreground">
                      No rows match.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {table && table.rows.length > DISPLAY_ROWS && (
        <p className="text-xs text-muted-foreground">Showing the first {DISPLAY_ROWS} rows; the CSV export includes all {table.rows.length}.</p>
      )}
    </div>
  );
}
