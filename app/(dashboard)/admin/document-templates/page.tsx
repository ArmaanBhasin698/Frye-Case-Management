import { format } from "date-fns";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { assertIsAdmin } from "@/lib/auth/access";
import { getMergeCatalog } from "@/lib/documents/merge-data";
import { CONTACT_MERGE_FIELDS, STATIC_MERGE_FIELDS } from "@/lib/documents/templates";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentTemplateForm, ReindexButton, TemplateStatusButton } from "@/components/shared/document-admin-forms";

/** ADMIN-only document template library (versioned) and content-index maintenance. */
export default async function DocumentTemplatesAdminPage() {
  const user = await requireCurrentUser();
  assertIsAdmin(user);

  const [templates, catalog, indexCounts, unindexed] = await Promise.all([
    prisma.documentTemplate.findMany({
      include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, body: true, createdAt: true, createdBy: { select: { name: true } } } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    getMergeCatalog(),
    prisma.documentTextIndex.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.documentVersion.count({ where: { currentFor: { isNot: null }, textIndex: { is: null } } }),
  ]);
  const fields = [
    ...STATIC_MERGE_FIELDS,
    ...CONTACT_MERGE_FIELDS,
    ...Object.entries(catalog.customLabels).map(([token, label]) => ({ token, label: `Custom — ${label}` })),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Document templates</h1>
        <p className="text-sm text-muted-foreground">
          Templates generate PDFs saved to a matter&apos;s documents. Unknown merge fields are rejected; missing values must be
          filled in or explicitly left blank when generating.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Content search index</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          {indexCounts.map((c) => (
            <Badge key={c.status} variant="outline">
              {c.status.toLowerCase()}: {c._count._all}
            </Badge>
          ))}
          <Badge variant="outline">not yet indexed: {unindexed}</Badge>
          <ReindexButton />
        </CardContent>
      </Card>

      <DocumentTemplateForm fields={fields} />

      {templates.map((t) => {
        const latest = t.versions[0];
        return (
          <Card key={t.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                {t.name}
                <Badge variant="outline">v{latest?.version ?? 0}</Badge>
                {t.status === "ARCHIVED" && <Badge variant="secondary">Archived</Badge>}
              </CardTitle>
              <TemplateStatusButton templateId={t.id} archived={t.status === "ARCHIVED"} />
            </CardHeader>
            <CardContent className="space-y-3">
              {latest && (
                <DocumentTemplateForm fields={fields} initial={{ id: t.id, name: t.name, category: t.category, body: latest.body }} />
              )}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Version history ({t.versions.length})</summary>
                <ul className="mt-1 space-y-0.5">
                  {t.versions.map((v) => (
                    <li key={v.id}>
                      v{v.version} — {format(v.createdAt, "MMM d, yyyy h:mm a")} by {v.createdBy?.name ?? "former staff"}
                    </li>
                  ))}
                </ul>
              </details>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
