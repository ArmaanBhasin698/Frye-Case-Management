"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { DocumentCategory } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import { documentStore } from "@/lib/storage/DocumentStore";
import { hashBuffer } from "@/lib/discovery/hash";
import { diffFields } from "@/lib/utils";
import { isAllowedDocumentFile } from "@/lib/documents/validation";

/**
 * Server Actions for general (non-discovery) Matter documents — upload and
 * metadata edit. Same conventions as lib/matters/actions.ts and
 * lib/discovery/actions.ts: every action independently re-checks
 * authentication and matter-level access, validates input with Zod, and
 * returns a generic denial that can't be used to probe for the existence
 * of a matter/document the caller isn't authorized to see.
 *
 * Authorization uses the plain matter-access rule (`hasMatterAccess`, any
 * assigned role), same as Notes/Tasks/Calls/Deadlines — docs/SECURITY.md
 * doesn't establish anything stricter for Documents, and per this pass's
 * fallback instruction that's the correct default.
 */

export type FormActionState = { error: string | null };
const FORM_OK: FormActionState = { error: null };
const NOT_FOUND_ERROR = "Not found or access denied.";

const cuid = z.string().min(1, "Required.");
const DOCUMENT_CATEGORY_VALUES = [
  "PLEADING",
  "CORRESPONDENCE",
  "CONTRACT",
  "OTHER",
] as const satisfies readonly DocumentCategory[];

/** Generous for fictional/test files; matches lib/discovery/actions.ts and next.config.mjs's serverActions.bodySizeLimit. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const uploadDocumentSchema = z.object({
  matterId: cuid,
  title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
  category: z.enum(DOCUMENT_CATEGORY_VALUES).default("OTHER"),
  notes: z
    .string()
    .trim()
    .max(2_000, "Notes are too long.")
    .optional()
    .transform((v) => (v ? v : undefined)),
  file: z
    .instanceof(File, { message: "Select a file to upload." })
    .refine((f) => f.size > 0, "The selected file is empty.")
    .refine((f) => f.size <= MAX_FILE_BYTES, "File is too large (25MB max for this demo)."),
});

export async function uploadDocument(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const parsed = uploadDocumentSchema.safeParse({
    matterId: formData.get("matterId"),
    title: formData.get("title"),
    category: formData.get("category") || "OTHER",
    notes: formData.get("notes") ?? undefined,
    file: formData.get("file"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, title, category, notes, file } = parsed.data;

  if (!isAllowedDocumentFile(file.name, file.type)) {
    return { error: "Unsupported file type. Upload a PDF, Word, Excel, text, or image file." };
  }

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND_ERROR };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = hashBuffer(buffer);

  // A fresh UUID, not the eventual Document row's id — the storage key is
  // generated before the DB row exists (same chicken-and-egg reasoning as
  // lib/discovery/actions.ts#registerDiscoveryFile). Deliberately never
  // the raw uploaded filename: a client-supplied name could contain the
  // client's real name or case details, which must never end up in a
  // storage path when an opaque id does the job just as well (see
  // docs/SECURITY.md) — the true original filename is preserved only as
  // DB metadata (`originalFilename`), not in the path. Every upload gets
  // its own fresh key, so two files sharing a filename never collide.
  const storageKey = `matters/${matterId}/documents/${randomUUID()}/original`;

  await documentStore.save(storageKey, buffer);

  let document;
  try {
    document = await prisma.document.create({
      data: {
        matterId,
        category,
        title,
        storageKey,
        originalFilename: file.name,
        mimeType: file.type || null,
        sizeBytes: buffer.byteLength,
        contentHash,
        uploadedById: user.id,
        notes,
      },
    });
  } catch (error) {
    // The file is now orphaned in the store with no DB row pointing to
    // it — DocumentStore has no delete method, so there's nothing to
    // clean up here. Acceptable for a local dev/demo store; the same
    // documented limitation lib/discovery/actions.ts#registerDiscoveryFile
    // already carries (see README.md's "Known limitations").
    console.error("[uploadDocument] failed to persist document metadata", error);
    return { error: "Failed to save document." };
  }

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "Document",
      entityId: document.id,
      matterId,
      metadata: { originalFilename: file.name, sizeBytes: buffer.byteLength, category },
    },
  });

  revalidatePath(`/matters/${matterId}/documents`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { ...FORM_OK };
}

const updateDocumentMetadataSchema = z.object({
  matterId: cuid,
  documentId: cuid,
  title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
  category: z.enum(DOCUMENT_CATEGORY_VALUES),
  notes: z
    .string()
    .trim()
    .max(2_000, "Notes are too long.")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export async function updateDocumentMetadata(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const parsed = updateDocumentMetadataSchema.safeParse({
    matterId: formData.get("matterId"),
    documentId: formData.get("documentId"),
    title: formData.get("title"),
    category: formData.get("category"),
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, documentId, title, category, notes } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND_ERROR };
  }

  // Scoped by matterId, not just id: a documentId from a different matter
  // can never be edited through this matter, even by a caller who has
  // legitimate write access to *some* matter. This only ever touches
  // title/category/notes — the original file bytes and storageKey are
  // never rewritten here.
  const before = await prisma.document.findFirst({
    where: { id: documentId, matterId },
    select: { title: true, category: true, notes: true },
  });
  if (!before) {
    return { error: NOT_FOUND_ERROR };
  }

  const nextNotes = notes ?? null;
  await prisma.document.update({
    where: { id: documentId },
    data: { title, category, notes: nextNotes },
  });

  // `notes` is free text — record only that it changed, never the
  // content, same pattern lib/clients/actions.ts#updateClient uses for
  // Client.notes (see docs/SECURITY.md's audit logging guidance).
  const changed = diffFields({ title: before.title, category: before.category }, { title, category });
  const notesChanged = before.notes !== nextNotes;

  if (Object.keys(changed).length > 0 || notesChanged) {
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Document",
        entityId: documentId,
        matterId,
        metadata: { changed, ...(notesChanged ? { notesChanged: true } : {}) },
      },
    });
  }

  revalidatePath(`/matters/${matterId}/documents`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { ...FORM_OK };
}
