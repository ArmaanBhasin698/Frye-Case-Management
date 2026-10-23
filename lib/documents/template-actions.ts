"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { DocumentCategory } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { documentStore } from "@/lib/storage/DocumentStore";
import { hashBuffer } from "@/lib/discovery/hash";
import { buildMergeValues, getMergeCatalog } from "@/lib/documents/merge-data";
import { renderTemplate, validateTemplateBody } from "@/lib/documents/templates";
import { UnsupportedCharactersError, renderGeneratedPdf } from "@/lib/documents/generated-pdf";
import { scheduleIndexing } from "@/lib/documents/schedule";
import { reindexPending } from "@/lib/documents/indexing";

/**
 * Document template library (ADMIN) and generation from a matter's
 * Documents tab. Template bodies are versioned and immutable; generating
 * never modifies a template or any discovery file. Generation requires the
 * same matter access as uploading a document (`hasMatterAccess`, any
 * assigned role). Audit metadata records ids/versions/counts only —
 * never template bodies or merged text.
 */

export type FormActionState = { error: string | null };
const NOT_FOUND = "Not found or access denied.";
const id = z.string().trim().min(1).max(100);
const CATEGORY_VALUES = ["PLEADING", "CORRESPONDENCE", "CONTRACT", "OTHER"] as const satisfies readonly DocumentCategory[];

const templateSchema = z.object({
  templateId: id.optional(),
  name: z.string().trim().min(1, "Name is required.").max(150, "Name is too long."),
  category: z.enum(CATEGORY_VALUES),
  body: z.string().max(50_000, "Template body is too long."),
});

/** Creates a template, or saves an edit as the next immutable version. */
export async function saveDocumentTemplate(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const parsed = templateSchema.safeParse({
    templateId: (formData.get("templateId") as string) || undefined,
    name: formData.get("name") ?? "",
    category: formData.get("category") || "CORRESPONDENCE",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { templateId, name, category, body } = parsed.data;

  const validation = validateTemplateBody(body, await getMergeCatalog());
  if (validation.error) return { error: validation.error };

  if (templateId) {
    const template = await prisma.documentTemplate.findUnique({
      where: { id: templateId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!template) return { error: NOT_FOUND };
    const latest = template.versions[0];
    const bodyChanged = latest?.body !== body;
    await prisma.$transaction(async (tx) => {
      await tx.documentTemplate.update({ where: { id: templateId }, data: { name, category } });
      if (bodyChanged) {
        await tx.documentTemplateVersion.create({
          data: { templateId, version: (latest?.version ?? 0) + 1, body, createdById: user.id },
        });
      }
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "UPDATE",
          entityType: "DocumentTemplate",
          entityId: templateId,
          metadata: { newVersion: bodyChanged ? (latest?.version ?? 0) + 1 : null },
        },
      });
    });
  } else {
    await prisma.$transaction(async (tx) => {
      const template = await tx.documentTemplate.create({ data: { name, category, createdById: user.id } });
      await tx.documentTemplateVersion.create({ data: { templateId: template.id, version: 1, body, createdById: user.id } });
      await tx.auditEvent.create({
        data: { actorId: user.id, action: "CREATE", entityType: "DocumentTemplate", entityId: template.id, metadata: { version: 1 } },
      });
    });
  }
  revalidatePath("/admin/document-templates");
  return { error: null };
}

export async function setDocumentTemplateStatus(input: { templateId: string; archived: boolean }): Promise<FormActionState> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const parsed = z.object({ templateId: id, archived: z.boolean() }).safeParse(input);
  if (!parsed.success) return { error: NOT_FOUND };
  const updated = await prisma.documentTemplate.updateMany({
    where: { id: parsed.data.templateId },
    data: { status: parsed.data.archived ? "ARCHIVED" : "ACTIVE" },
  });
  if (updated.count === 0) return { error: NOT_FOUND };
  await prisma.auditEvent.create({
    data: { actorId: user.id, action: "UPDATE", entityType: "DocumentTemplate", entityId: parsed.data.templateId, metadata: { archived: parsed.data.archived } },
  });
  revalidatePath("/admin/document-templates");
  return { error: null };
}

/** ADMIN maintenance: index current versions with no/failed/pending index rows (bounded). */
export async function reindexPendingDocuments(): Promise<{ error: string | null; processed?: number }> {
  const user = await requireCurrentUser();
  if (!isAdmin(user)) return { error: NOT_FOUND };
  const processed = await reindexPending(50);
  await prisma.auditEvent.create({
    data: { actorId: user.id, action: "UPDATE", entityType: "DocumentTextIndex", entityId: "maintenance", metadata: { processed } },
  });
  revalidatePath("/admin/document-templates");
  return { error: null, processed };
}

// --- Generation -----------------------------------------------------------------------

const generateSchema = z.object({
  matterId: id,
  templateVersionId: id,
  title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
  folderId: id.optional(),
  leaveBlank: z.boolean(),
  replaceUnsupported: z.boolean(),
});

/**
 * Generates a PDF from the exact template version the user previewed and
 * stores it as a normal Document (+ immutable v1 version) with provenance.
 * Re-validates everything server-side: matter access, the template
 * version (active template), the folder (same matter), unknown tokens,
 * missing values (blocked unless "leave blank" was explicitly chosen), and
 * characters the PDF font can't encode (blocked unless replacement was
 * explicitly accepted).
 */
export async function generateDocumentFromTemplate(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = generateSchema.safeParse({
    matterId: formData.get("matterId"),
    templateVersionId: formData.get("templateVersionId"),
    title: formData.get("title") ?? "",
    folderId: (formData.get("folderId") as string) || undefined,
    leaveBlank: formData.get("leaveBlank") === "on",
    replaceUnsupported: formData.get("replaceUnsupported") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { matterId, templateVersionId, title, folderId, leaveBlank, replaceUnsupported } = parsed.data;
  if (!(await hasMatterAccess(user, matterId))) return { error: NOT_FOUND };

  const version = await prisma.documentTemplateVersion.findUnique({
    where: { id: templateVersionId },
    include: { template: { select: { id: true, status: true, category: true } } },
  });
  if (!version || version.template.status !== "ACTIVE") return { error: NOT_FOUND };
  if (folderId && (await prisma.documentFolder.count({ where: { id: folderId, matterId } })) === 0) return { error: NOT_FOUND };

  const validation = validateTemplateBody(version.body, await getMergeCatalog());
  if (validation.error) return { error: validation.error };
  const values = await buildMergeValues(matterId, user);
  if (!values) return { error: NOT_FOUND };
  const rendered = renderTemplate(version.body, values, { leaveBlank });
  if (rendered.missing.length > 0 && !leaveBlank) {
    return { error: `Missing values for: ${rendered.missing.map((m) => `{{${m}}}`).join(", ")}. Fill them in, or confirm leaving them blank.` };
  }

  let pdf: Uint8Array;
  try {
    pdf = await renderGeneratedPdf({
      title,
      subtitle: `${values["matter.caseNumber"] ?? ""} · Generated ${values.today ?? ""} by ${user.name ?? "staff"}`,
      body: rendered.text,
      replaceUnsupported,
    });
  } catch (error) {
    if (error instanceof UnsupportedCharactersError) {
      return { error: `The PDF font can't print: ${error.characters.join(" ")}. Edit the data/template, or confirm replacing them with "?".` };
    }
    throw error;
  }

  const buffer = Buffer.from(pdf);
  const storageKey = `matters/${matterId}/documents/${randomUUID()}/original`;
  await documentStore.save(storageKey, buffer);
  const contentHash = hashBuffer(buffer);
  const filename = `${title.replace(/[^A-Za-z0-9 ._-]/g, "").trim().slice(0, 80) || "generated"}.pdf`;

  const created = await prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        matterId,
        category: version.template.category,
        title,
        storageKey,
        originalFilename: filename,
        mimeType: "application/pdf",
        sizeBytes: buffer.byteLength,
        contentHash,
        uploadedById: user.id,
        folderId: folderId ?? null,
        generatedFromTemplateVersionId: version.id,
      },
    });
    const v1 = await tx.documentVersion.create({
      data: {
        documentId: document.id,
        version: 1,
        storageKey,
        originalFilename: filename,
        mimeType: "application/pdf",
        sizeBytes: buffer.byteLength,
        contentHash,
        uploadedById: user.id,
      },
    });
    await tx.document.update({ where: { id: document.id }, data: { currentVersionId: v1.id } });
    await tx.auditEvent.create({
      data: {
        actorId: user.id,
        action: "CREATE",
        entityType: "Document",
        entityId: document.id,
        matterId,
        metadata: {
          generated: true,
          templateId: version.template.id,
          templateVersion: version.version,
          missingLeftBlank: rendered.missing.length,
          sizeBytes: buffer.byteLength,
        },
      },
    });
    return { documentId: document.id, versionId: v1.id };
  });

  scheduleIndexing(created.versionId);
  revalidatePath(`/matters/${matterId}/documents`);
  redirect(`/matters/${matterId}/documents`);
}
