import Link from "next/link";

import { requireCurrentUser } from "@/lib/auth/session";
import { assertMatterAccess } from "@/lib/auth/access";
import { flattenFolders, getDocumentWorkspace } from "@/lib/documents/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentList } from "@/components/shared/document-list";
import { UploadDocumentForm } from "@/components/shared/upload-document-form";
import { ApplyFolderSetForm, ManageFolderForm, NewFolderForm } from "@/components/shared/document-workspace";
import { cn } from "@/lib/utils";

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

/**
 * Matter Documents workspace: folders (metadata only), tags, version
 * history with per-version downloads and index status, template
 * generation, and content search. Re-asserts matter access itself.
 */
export default async function MatterDocumentsPage({
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
  const folderFilter = one(sp.folder);
  const tagFilter = one(sp.tag);

  const { documents, folders, tags, folderSets, templates } = await getDocumentWorkspace(matterId, {
    folderId: folderFilter,
    tag: tagFilter,
  });
  const tree = flattenFolders(folders);
  const folderOptions = tree.map((f) => ({ id: f.id, path: f.path, depth: f.depth }));
  const pathById = new Map(tree.map((f) => [f.id, f.path]));
  const base = `/matters/${matterId}/documents`;

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <aside className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Folders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <nav className="space-y-0.5">
              <Link href={base} className={cn("block rounded px-2 py-1 hover:bg-accent", !folderFilter && !tagFilter && "bg-accent font-medium")}>
                All documents
              </Link>
              <Link href={`${base}?folder=root`} className={cn("block rounded px-2 py-1 hover:bg-accent", folderFilter === "root" && "bg-accent font-medium")}>
                Unfiled
              </Link>
              {tree.map((f) => (
                <Link
                  key={f.id}
                  href={`${base}?folder=${f.id}`}
                  className={cn("block rounded px-2 py-1 hover:bg-accent", folderFilter === f.id && "bg-accent font-medium")}
                  style={{ paddingLeft: `${0.5 + f.depth}rem` }}
                >
                  {f.name} <span className="text-xs text-muted-foreground">({f._count.documents})</span>
                </Link>
              ))}
            </nav>
            <NewFolderForm matterId={matterId} folders={folderOptions} />
            <ManageFolderForm matterId={matterId} folders={folderOptions} />
            <ApplyFolderSetForm matterId={matterId} sets={folderSets} />
          </CardContent>
        </Card>
        {tags.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Tags</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <Link key={t} href={`${base}?tag=${encodeURIComponent(t)}`}>
                  <Badge variant={tagFilter === t ? "default" : "outline"}>#{t}</Badge>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </aside>

      <div className="space-y-4 lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {documents.length} {documents.length === 1 ? "document" : "documents"}
            {folderFilter === "root" ? " unfiled" : folderFilter ? ` in ${pathById.get(folderFilter) ?? "folder"}` : ""}
            {tagFilter ? ` tagged #${tagFilter}` : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`${base}/search`}>Search contents</Link>
            </Button>
            {templates.length > 0 && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`${base}/generate`}>Generate from template</Link>
              </Button>
            )}
            <UploadDocumentForm
              matterId={matterId}
              folders={folderOptions}
              defaultFolderId={folderFilter && folderFilter !== "root" ? folderFilter : undefined}
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <DocumentList
              matterId={matterId}
              folders={folderOptions}
              documents={documents.map((doc) => ({
                id: doc.id,
                title: doc.title,
                category: doc.category,
                originalFilename: doc.originalFilename,
                sizeBytes: doc.sizeBytes,
                uploadedAt: doc.uploadedAt,
                uploadedBy: doc.uploadedBy,
                notes: doc.notes,
                // Rows seeded before real upload support carry a fake,
                // Dropbox-shaped path string with nothing actually stored
                // behind them — only offer a download once there's real
                // content (see docs/DATA_MODEL.md's Document entry).
                hasStoredFile: doc.storageKey.startsWith("matters/"),
                folderId: doc.folderId,
                folderName: doc.folderId ? (pathById.get(doc.folderId) ?? null) : null,
                tags: doc.tags,
                currentVersionId: doc.currentVersionId,
                generatedFrom: doc.generatedFromTemplateVersion
                  ? `${doc.generatedFromTemplateVersion.template.name} v${doc.generatedFromTemplateVersion.version}`
                  : null,
                versions: doc.versions.map((v) => ({
                  id: v.id,
                  version: v.version,
                  originalFilename: v.originalFilename,
                  sizeBytes: v.sizeBytes,
                  contentHash: v.contentHash,
                  createdAt: v.createdAt,
                  uploadedBy: v.uploadedBy?.name ?? null,
                  indexStatus: v.textIndex?.status ?? null,
                })),
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
