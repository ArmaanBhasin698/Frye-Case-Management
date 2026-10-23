import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Reads for the matter Documents workspace. Callers must already have
 * asserted access to `matterId`; every query is scoped to it.
 */

export type DocumentWorkspaceFilters = { folderId?: string | "root"; tag?: string };

export async function getDocumentWorkspace(matterId: string, filters: DocumentWorkspaceFilters = {}) {
  const where: Prisma.DocumentWhereInput = { matterId };
  if (filters.folderId === "root") where.folderId = null;
  else if (filters.folderId) where.folderId = filters.folderId;
  if (filters.tag) where.tags = { has: filters.tag };

  const [documents, folders, tagRows, folderSets, templates] = await Promise.all([
    prisma.document.findMany({
      where,
      include: {
        uploadedBy: { select: { name: true } },
        folder: { select: { id: true, name: true } },
        generatedFromTemplateVersion: { select: { version: true, template: { select: { name: true } } } },
        versions: {
          orderBy: { version: "desc" },
          select: {
            id: true,
            version: true,
            originalFilename: true,
            sizeBytes: true,
            contentHash: true,
            createdAt: true,
            uploadedBy: { select: { name: true } },
            textIndex: { select: { status: true } },
          },
        },
      },
      orderBy: { uploadedAt: "desc" },
    }),
    prisma.documentFolder.findMany({
      where: { matterId },
      select: { id: true, name: true, parentId: true, position: true, _count: { select: { documents: true } } },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    }),
    prisma.document.findMany({ where: { matterId }, select: { tags: true } }),
    prisma.documentFolderSet.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.documentTemplate.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const tags = [...new Set(tagRows.flatMap((r) => r.tags))].sort();
  return { documents, folders, tags, folderSets, templates };
}

/** Folder tree flattened depth-first with depth, for indented selects and the sidebar. */
export function flattenFolders<T extends { id: string; parentId: string | null; name: string }>(folders: T[]) {
  const byParent = new Map<string | null, T[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  const out: (T & { depth: number; path: string })[] = [];
  const walk = (parentId: string | null, depth: number, prefix: string) => {
    for (const f of byParent.get(parentId) ?? []) {
      const path = prefix ? `${prefix}/${f.name}` : f.name;
      out.push({ ...f, depth, path });
      walk(f.id, depth + 1, path);
    }
  };
  walk(null, 0, "");
  return out;
}
