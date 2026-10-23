import Link from "next/link";

import { prisma } from "@/lib/db";
import { requireCurrentUser } from "@/lib/auth/session";
import { assertMatterAccess } from "@/lib/auth/access";
import { buildMergeValues, getMergeCatalog } from "@/lib/documents/merge-data";
import { renderTemplate, validateTemplateBody } from "@/lib/documents/templates";
import { findUnsupportedCharacters } from "@/lib/documents/generated-pdf";
import { flattenFolders } from "@/lib/documents/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { GenerateDocumentForm } from "@/components/shared/generate-document-form";

/**
 * Preview → confirm generation from a template. The preview is rendered
 * server-side from this matter's own data only; missing values stay
 * visible as {{tokens}} so gaps are obvious, and nothing is stored until
 * the user confirms.
 */
export default async function GenerateDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { matterId } = await params;
  const user = await requireCurrentUser();
  await assertMatterAccess(user, matterId);
  const sp = await searchParams;
  const templateId = typeof sp.templateId === "string" ? sp.templateId : undefined;

  const [templates, folders] = await Promise.all([
    prisma.documentTemplate.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.documentFolder.findMany({ where: { matterId }, select: { id: true, name: true, parentId: true } }),
  ]);

  let preview: {
    versionId: string;
    version: number;
    name: string;
    text: string;
    missing: string[];
    unknownError: string | null;
    unsupported: string[];
  } | null = null;

  if (templateId) {
    const template = await prisma.documentTemplate.findFirst({
      where: { id: templateId, status: "ACTIVE" },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const latest = template?.versions[0];
    const values = await buildMergeValues(matterId, user);
    if (template && latest && values) {
      const validation = validateTemplateBody(latest.body, await getMergeCatalog());
      const shown = renderTemplate(latest.body, values);
      const blanked = renderTemplate(latest.body, values, { leaveBlank: true });
      preview = {
        versionId: latest.id,
        version: latest.version,
        name: template.name,
        text: shown.text,
        missing: shown.missing,
        unknownError: validation.error,
        unsupported: await findUnsupportedCharacters(blanked.text),
      };
    }
  }

  const folderOptions = flattenFolders(folders).map((f) => ({ id: f.id, path: f.path }));

  return (
    <div className="space-y-4">
      <Link href={`/matters/${matterId}/documents`} className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Documents
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Generate a document from a template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active templates yet — an admin can add them under Document templates.</p>
          ) : (
            <form method="get" className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="tpl" className="text-xs">
                  Template
                </Label>
                <Select id="tpl" name="templateId" defaultValue={templateId ?? ""} className="w-72">
                  <option value="" disabled>
                    Choose a template…
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" size="sm" variant="outline">
                Preview
              </Button>
            </form>
          )}

          {templateId && !preview && <p className="text-sm text-destructive">Template not found or no longer active.</p>}

          {preview && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Preview of <strong>{preview.name}</strong> (version {preview.version}) using this matter&apos;s data.
              </p>
              {preview.unknownError && <p className="text-sm font-medium text-destructive">{preview.unknownError}</p>}
              {preview.missing.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  Missing values: {preview.missing.map((m) => `{{${m}}}`).join(", ")}. Fill them in on the matter/client, or
                  confirm leaving them blank below.
                </div>
              )}
              {preview.unsupported.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  The PDF font can&apos;t print these characters: {preview.unsupported.join(" ")}
                </div>
              )}
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-4 font-sans text-sm">
                {preview.text}
              </pre>
              {!preview.unknownError && (
                <GenerateDocumentForm
                  matterId={matterId}
                  templateVersionId={preview.versionId}
                  defaultTitle={preview.name}
                  folders={folderOptions}
                  hasMissing={preview.missing.length > 0}
                  unsupported={preview.unsupported}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
