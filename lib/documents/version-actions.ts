"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import { documentStore } from "@/lib/storage/DocumentStore";
import { hashBuffer } from "@/lib/discovery/hash";
import { isAllowedDocumentFile } from "@/lib/documents/validation";
import { scheduleIndexing } from "@/lib/documents/schedule";

export type FormActionState = { error: string | null };
const NOT_FOUND_ERROR = "Not found or access denied.";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const uploadVersionSchema = z.object({
  matterId: z.string().min(1),
  documentId: z.string().min(1),
  file: z
    .instanceof(File, { message: "Select a file to upload." })
    .refine((f) => f.size > 0, "The selected file is empty.")
    .refine((f) => f.size <= MAX_FILE_BYTES, "File is too large (25MB max for this demo)."),
});

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

/**
 * Appends a new version of a general document. The new bytes go to a
 * brand-new storage key — earlier versions' bytes are never overwritten
 * (DocumentStore.save is write-once). A legacy Document with no version
 * rows (created before versioning) first gets its implicit v1 recorded
 * from its own columns. The Document's storage columns and
 * `currentVersionId` move to the new version in the same transaction, so
 * the existing download link always serves the current version. A
 * concurrent upload of the same document loses the unique
 * (documentId, version) race and is asked to retry — never merged.
 */
export async function uploadDocumentVersion(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = uploadVersionSchema.safeParse({
    matterId: formData.get("matterId"),
    documentId: formData.get("documentId"),
    file: formData.get("file"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { matterId, documentId, file } = parsed.data;

  if (!isAllowedDocumentFile(file.name, file.type)) {
    return { error: "Unsupported file type. Upload a PDF, Word, Excel, text, or image file." };
  }
  if (!(await hasMatterAccess(user, matterId))) return { error: NOT_FOUND_ERROR };

  const existing = await prisma.document.findFirst({ where: { id: documentId, matterId } });
  if (!existing) return { error: NOT_FOUND_ERROR };

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = hashBuffer(buffer);
  const storageKey = `matters/${matterId}/documents/${randomUUID()}/original`;
  await documentStore.save(storageKey, buffer);

  let created: { id: string; version: number };
  try {
    created = await prisma.$transaction(async (tx) => {
      const count = await tx.documentVersion.count({ where: { documentId } });
      if (count === 0) {
        await tx.documentVersion.create({
          data: {
            documentId,
            version: 1,
            storageKey: existing.storageKey,
            originalFilename: existing.originalFilename,
            mimeType: existing.mimeType,
            sizeBytes: existing.sizeBytes,
            contentHash: existing.contentHash,
            uploadedById: existing.uploadedById,
            createdAt: existing.uploadedAt,
          },
        });
      }
      const latest = await tx.documentVersion.aggregate({ where: { documentId }, _max: { version: true } });
      const version = await tx.documentVersion.create({
        data: {
          documentId,
          version: (latest._max.version ?? 0) + 1,
          storageKey,
          originalFilename: file.name,
          mimeType: file.type || null,
          sizeBytes: buffer.byteLength,
          contentHash,
          uploadedById: user.id,
        },
      });
      await tx.document.update({
        where: { id: documentId },
        data: {
          storageKey,
          originalFilename: file.name,
          mimeType: file.type || null,
          sizeBytes: buffer.byteLength,
          contentHash,
          currentVersionId: version.id,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "UPDATE",
          entityType: "Document",
          entityId: documentId,
          matterId,
          metadata: { newVersion: version.version, sizeBytes: buffer.byteLength },
        },
      });
      return { id: version.id, version: version.version };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { error: "Another version of this document was uploaded at the same moment — refresh and try again." };
    }
    throw error;
  }

  scheduleIndexing(created.id);
  revalidatePath(`/matters/${matterId}/documents`);
  return { error: null };
}
