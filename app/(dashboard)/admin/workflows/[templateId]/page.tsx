import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { getTemplateDetail, listActiveStaffOptions } from "@/lib/workflows/queries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowTemplateEditor, type EditorStep } from "@/components/shared/workflows/template-editor";
import { TemplateStatusButton } from "@/components/shared/workflows/template-admin-buttons";

/** Edit a template (saves the next immutable version) and review its version history. */
export default async function WorkflowTemplateDetailPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const user = await requireCurrentUser();
  assertIsAdmin(user);
  const [template, staff] = await Promise.all([getTemplateDetail(templateId), listActiveStaffOptions()]);
  if (!template) notFound();
  const latest = template.versions[0];

  const steps: EditorStep[] = (latest?.steps ?? []).map((s) => ({
    kind: s.kind,
    title: s.title,
    description: s.description ?? "",
    priority: s.priority,
    offsetDays: s.offsetDays,
    timeOfDay: s.timeOfDay ?? "",
    durationMinutes: s.durationMinutes ?? "",
    eventType: s.eventType ?? "OTHER",
    assigneeRule: s.assigneeRule,
    assigneeUserId: s.assigneeUserId ?? "",
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/workflows" className="text-sm text-muted-foreground hover:text-foreground">
            &larr; Workflow templates
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="page-title">{template.name}</h1>
            <Badge variant="outline">v{latest?.version ?? 0}</Badge>
            {template.status === "ARCHIVED" && <Badge variant="secondary">Archived</Badge>}
          </div>
        </div>
        <TemplateStatusButton templateId={template.id} archived={template.status === "ARCHIVED"} />
      </div>

      <WorkflowTemplateEditor
        key={latest?.id}
        templateId={template.id}
        staff={staff}
        initial={{ name: template.name, description: template.description ?? "", category: template.category, steps }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Version history</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border text-sm">
            {template.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  v{v.version} · {v.steps.length} steps · {format(v.createdAt, "MMM d, yyyy h:mm a")}
                  {v.createdBy ? ` by ${v.createdBy.name}` : ""}
                </span>
                <span className="text-muted-foreground">applied {v._count.applications} time(s)</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
