"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import {
  MAX_FOLDER_DEPTH,
  folderDepth,
  parseFolderSetPaths,
  parseTags,
  validateFolderName,
  wouldCreateCycle,
} from "@/lib/documents/folders";

/**
 * Matter document folders, tags, and reusable folder sets. Folders are
 * metadata: creating, renaming, or moving them — or moving a document
 * into one — never touches stored bytes and never changes who can see the
 * document (always the matter's access rule). Folder writes for one matter
 * are serialized with a transaction-scoped advisory lock, so concurrent
 * "create folder" / "apply folder set" requests can't create duplicate
 * root folders (Postgres treats NULL parent ids as distinct in the unique
 * index). Audit metadata records ids and counts only — never folder names
 * or tags, which can describe case content.
 */

export type FormActionState = { error: string | null };
const NOT_FOUND = "Not found or access denied.";
const id = z.string().trim().min(1).max(100);

async function lockMatterFolders(tx: Prisma.TransactionClient, matterId: string) {
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns `void`, which
  // Prisma can't deserialize as a result row.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`document-folders:${matterId}`}))`;
}

function revalidateDocs(matterId: string) {
  revalidatePath(`/matters/${matterId}/documents`);
}

export async function createFolder(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = z
    .object({ matterId: id, name: z.string().max(200), parentId: id.optional() })
    .safeParse({
      matterId: formData.get("matterId"),
      name: formData.get("name") ?? "",
      parentId: (formData.get("parentId") as string) || undefined,
    });
  if (!parsed.success) return { error: NOT_FOUND };
  const { matterId, parentId } = parsed.data;
  const name = parsed.data.name.trim();
  const nameError = validateFolderName(name);
  if (nameError) return { error: nameError };
  if (!(await hasMatterAccess(user, matterId))) return { error: NOT_FOUND };

  const result = await prisma.$transaction(async (tx) => {
    await lockMatterFolders(tx, matterId);
    const folders = await tx.documentFolder.findMany({ where: { matterId }, select: { id: true, parentId: true, name: true } });
    if (parentId && !folders.some((f) => f.id === parentId)) return { error: NOT_FOUND };
    if (folderDepth(folders, parentId ?? null) + 1 > MAX_FOLDER_DEPTH) return { error: `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels.` };
    if (folders.some((f) => (f.parentId ?? null) === (parentId ?? null) && f.name.toLowerCase() === name.toLowerCase())) {
      return { error: "A folder with that name already exists here." };
    }
    const folder = await tx.documentFolder.create({ data: { matterId, name, parentId: parentId ?? null } });
    await tx.auditEvent.create({
      data: { actorId: user.id, action: "CREATE", entityType: "DocumentFolder", entityId: folder.id, matterId, metadata: { parentId: parentId ?? null } },
    });
    return { error: null };
  });
  revalidateDocs(matterId);
  return result;
}

export async function renameFolder(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = z.object({ matterId: id, folderId: id, name: z.string().max(200) }).safeParse({
    matterId: formData.get("matterId"),
    folderId: formData.get("folderId"),
    name: formData.get("name") ?? "",
  });
  if (!parsed.success) return { error: NOT_FOUND };
  const { matterId, folderId } = parsed.data;
  const name = parsed.data.name.trim();
  const nameError = validateFolderName(name);
  if (nameError) return { error: nameError };
  if (!(await hasMatterAccess(user, matterId))) return { error: NOT_FOUND };

  const result = await prisma.$transaction(async (tx) => {
    await lockMatterFolders(tx, matterId);
    const folder = await tx.documentFolder.findFirst({ where: { id: folderId, matterId } });
    if (!folder) return { error: NOT_FOUND };
    const clash = await tx.documentFolder.count({
      where: { matterId, parentId: folder.parentId, name: { equals: name, mode: "insensitive" }, id: { not: folderId } },
    });
    if (clash > 0) return { error: "A folder with that name already exists here." };
    await tx.documentFolder.update({ where: { id: folderId }, data: { name } });
    await tx.auditEvent.create({
      data: { actorId: user.id, action: "UPDATE", entityType: "DocumentFolder", entityId: folderId, matterId, metadata: { renamed: true } },
    });
    return { error: null };
  });
  revalidateDocs(matterId);
  return result;
}

export async function moveFolder(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = z.object({ matterId: id, folderId: id, parentId: id.optional() }).safeParse({
    matterId: formData.get("matterId"),
    folderId: formData.get("folderId"),
    parentId: (formData.get("parentId") as string) || undefined,
  });
  if (!parsed.success) return { error: NOT_FOUND };
  const { matterId, folderId } = parsed.data;
  const parentId = parsed.data.parentId ?? null;
  if (!(await hasMatterAccess(user, matterId))) return { error: NOT_FOUND };

  const result = await prisma.$transaction(async (tx) => {
    await lockMatterFolders(tx, matterId);
    const folders = await tx.documentFolder.findMany({ where: { matterId }, select: { id: true, parentId: true, name: true } });
    const folder = folders.find((f) => f.id === folderId);
    if (!folder || (parentId && !folders.some((f) => f.id === parentId))) return { error: NOT_FOUND };
    if (wouldCreateCycle(folders, folderId, parentId)) return { error: "A folder can't be moved inside itself." };
    if (folderDepth(folders, parentId) + 1 > MAX_FOLDER_DEPTH) return { error: `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels.` };
    if (folders.some((f) => f.id !== folderId && (f.parentId ?? null) === parentId && f.name.toLowerCase() === folder.name.toLowerCase())) {
      return { error: "A folder with that name already exists there." };
    }
    await tx.documentFolder.update({ where: { id: folderId }, data: { parentId } });
    await tx.auditEvent.create({
      data: { actorId: user.id, action: "UPDATE", entityType: "DocumentFolder", entityId: folderId, matterId, metadata: { parentId } },
    });
    return { error: null };
  });
  revalidateDocs(matterId);
  return result;
}

/** Moves a document between folders (or to the matter root). Metadata only. */
export async function moveDocument(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = z.object({ matterId: id, documentId: id, folderId: id.optional() }).safeParse({
    matterId: formData.get("matterId"),
    documentId: formData.get("documentId"),
    folderId: (formData.get("folderId") as string) || undefined,
  });
  if (!parsed.success) return { error: NOT_FOUND };
  const { matterId, documentId } = parsed.data;
  const folderId = parsed.data.folderId ?? null;
  if (!(await hasMatterAccess(user, matterId))) return { error: NOT_FOUND };

  const document = await prisma.document.findFirst({ where: { id: documentId, matterId }, select: { id: true, folderId: true } });
  if (!document) return { error: NOT_FOUND };
  if (folderId && (await prisma.documentFolder.count({ where: { id: folderId, matterId } })) === 0) return { error: NOT_FOUND };

  await prisma.$transaction([
    prisma.document.update({ where: { id: documentId }, data: { folderId } }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Document",
        entityId: documentId,
        matterId,
        metadata: { changed: { folderId: { before: document.folderId, after: folderId } } },
      },
    }),
  ]);
  revalidateDocs(matterId);
  return { error: null };
}

export async function setDocumentTags(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = z.object({ matterId: id, documentId: id, tags: z.string().max(1_000) }).safeParse({
    matterId: formData.get("matterId"),
    documentId: formData.get("documentId"),
    tags: formData.get("tags") ?? "",
  });
  if (!parsed.success) return { error: NOT_FOUND };
  const { matterId, documentId } = parsed.data;
  const { tags, error } = parseTags(parsed.data.tags);
  if (error) return { error };
  if (!(await hasMatterAccess(user, matterId))) return { error: NOT_FOUND };

  const document = await prisma.document.findFirst({ where: { id: documentId, matterId }, select: { id: true } });
  if (!document) return { error: NOT_FOUND };

  await prisma.$transaction([
    prisma.document.update({ where: { id: documentId }, data: { tags } }),
    prisma.auditEvent.create({
      data: { actorId: user.id, action: "UPDATE", entityType: "Document", entityId: documentId, matterId, metadata: { tagsChanged: true, tagCount: tags.length } },
    }),
  ]);
  revalidateDocs(matterId);
  return { error: null };
}

/**
 * Applies a reusable folder set to a matter: creates only the folders
 * that don't exist yet (matching names case-insensitively at each level),
 * so applying the same set twice — or concurrently — creates nothing new.
 */
export async function applyFolderSet(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = z.object({ matterId: id, setId: id }).safeParse({ matterId: formData.get("matterId"), setId: formData.get("setId") });
  if (!parsed.success) return { error: NOT_FOUND };
  const { matterId, setId } = parsed.data;
  if (!(await hasMatterAccess(user, matterId))) return { error: NOT_FOUND };

  const set = await prisma.documentFolderSet.findFirst({
    where: { id: setId, archivedAt: null },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!set) return { error: NOT_FOUND };

  await prisma.$transaction(async (tx) => {
    await lockMatterFolders(tx, matterId);
    const folders = await tx.documentFolder.findMany({ where: { matterId }, select: { id: true, parentId: true, name: true } });
    let created = 0;
    for (const item of set.items) {
      let parentId: string | null = null;
      for (const segment of item.path.split("/")) {
        const existing = folders.find((f) => (f.parentId ?? null) === parentId && f.name.toLowerCase() === segment.toLowerCase());
        if (existing) {
          parentId = existing.id;
          continue;
        }
        const folder: { id: string } = await tx.documentFolder.create({
          data: { matterId, name: segment, parentId, position: item.position },
          select: { id: true },
        });
        folders.push({ id: folder.id, parentId, name: segment });
        parentId = folder.id;
        created += 1;
      }
    }
    await tx.auditEvent.create({
      data: { actorId: user.id, action: "UPDATE", entityType: "DocumentFolderSet", entityId: setId, matterId, metadata: { appliedToMatter: true, foldersCreated: created } },
    });
  });
  revalidateDocs(matterId);
  return { error: null };
}

// --- ADMIN: folder set library -----------------------------------------------------

const folderSetSchema = z.object({
  setId: id.optional(),
  name: z.string().trim().min(1, "Name is required.").max(150, "Name is too long."),
  paths: z.string().max(10_000),
});

export async function saveFolderSet(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const parsed = folderSetSchema.safeParse({
    setId: (formData.get("setId") as string) || undefined,
    name: formData.get("name") ?? "",
    paths: formData.get("paths") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { setId, name } = parsed.data;
  const { paths, invalid } = parseFolderSetPaths(parsed.data.paths);
  if (invalid.length > 0) return { error: `Invalid folder path${invalid.length === 1 ? "" : "s"}: ${invalid.slice(0, 3).join(", ")}` };
  if (paths.length === 0) return { error: "Add at least one folder path." };

  if (setId && (await prisma.documentFolderSet.count({ where: { id: setId } })) === 0) return { error: NOT_FOUND };

  await prisma.$transaction(async (tx) => {
    let targetId = setId;
    if (targetId) {
      await tx.documentFolderSet.update({ where: { id: targetId }, data: { name } });
      await tx.documentFolderSetItem.deleteMany({ where: { setId: targetId } });
    } else {
      targetId = (await tx.documentFolderSet.create({ data: { name } })).id;
    }
    await tx.documentFolderSetItem.createMany({ data: paths.map((path, position) => ({ setId: targetId!, path, position })) });
    await tx.auditEvent.create({
      data: { actorId: user.id, action: setId ? "UPDATE" : "CREATE", entityType: "DocumentFolderSet", entityId: targetId!, metadata: { itemCount: paths.length } },
    });
  });
  revalidatePath("/admin/folder-sets");
  return { error: null };
}

export async function setFolderSetArchived(input: { setId: string; archived: boolean }): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const parsed = z.object({ setId: id, archived: z.boolean() }).safeParse(input);
  if (!parsed.success) return { error: NOT_FOUND };
  const updated = await prisma.documentFolderSet.updateMany({
    where: { id: parsed.data.setId },
    data: { archivedAt: parsed.data.archived ? new Date() : null },
  });
  if (updated.count === 0) return { error: NOT_FOUND };
  await prisma.auditEvent.create({
    data: { actorId: user.id, action: "UPDATE", entityType: "DocumentFolderSet", entityId: parsed.data.setId, metadata: { archived: parsed.data.archived } },
  });
  revalidatePath("/admin/folder-sets");
  return { error: null };
}
