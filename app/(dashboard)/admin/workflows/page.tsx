import Link from "next/link";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { listTemplates } from "@/lib/workflows/queries";
import { WORKFLOW_CATEGORY_LABELS } from "@/lib/workflows/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InstallStartersButton, TemplateStatusButton } from "@/components/shared/workflows/template-admin-buttons";

/** ADMIN-only workflow template library (active / archived). */
export default async function WorkflowTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  assertIsAdmin(user);
  const archived = (await searchParams).archived === "1";
  const templates = await listTemplates(archived ? "ARCHIVED" : "ACTIVE");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Workflow templates</h1>
          <p className="text-sm text-muted-foreground">
            Reusable task and event checklists applied to a matter from its Workflows tab. Editing saves a new version;
            workflows already applied keep the version they used.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InstallStartersButton />
          <Button size="sm" asChild>
            <Link href="/admin/workflows/new">New template</Link>
          </Button>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant={archived ? "outline" : "default"} size="sm" asChild>
          <Link href="/admin/workflows">Active</Link>
        </Button>
        <Button variant={archived ? "default" : "outline"} size="sm" asChild>
          <Link href="/admin/workflows?archived=1">Archived</Link>
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Times applied (this version)</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => {
                const latest = t.versions[0];
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link href={`/admin/workflows/${t.id}`} className="font-medium hover:underline">
                        {t.name}
                      </Link>
                      {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{WORKFLOW_CATEGORY_LABELS[t.category]}</Badge>
                    </TableCell>
                    <TableCell>v{latest?.version ?? "—"}</TableCell>
                    <TableCell>{latest?._count.steps ?? 0}</TableCell>
                    <TableCell>{latest?._count.applications ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <TemplateStatusButton templateId={t.id} archived={t.status === "ARCHIVED"} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    {archived ? "No archived templates." : "No templates yet — create one or install the starter templates."}
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
