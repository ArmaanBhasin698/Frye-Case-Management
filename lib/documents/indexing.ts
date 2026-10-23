import { prisma } from "@/lib/db";
import { documentStore } from "@/lib/storage/DocumentStore";
import { extractText } from "@/lib/documents/extraction";

/**
 * Builds/refreshes the content index for one DocumentVersion. Never
 * throws: indexing runs after an upload has already committed (via
 * `after()`), so an extraction or storage failure is recorded as FAILED
 * rather than surfacing as an upload error.
 */
export async function indexDocumentVersion(versionId: string): Promise<void> {
  try {
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      select: { id: true, storageKey: true, mimeType: true, originalFilename: true },
    });
    if (!version) return;

    let result;
    try {
      const bytes = await documentStore.read(version.storageKey);
      result = await extractText(bytes, version.mimeType, version.originalFilename);
    } catch {
      result = { status: "FAILED" as const, text: null, extractor: null };
    }

    await prisma.documentTextIndex.upsert({
      where: { documentVersionId: version.id },
      create: {
        documentVersionId: version.id,
        status: result.status,
        text: result.text,
        extractor: result.extractor,
        extractedAt: new Date(),
      },
      update: { status: result.status, text: result.text, extractor: result.extractor, extractedAt: new Date() },
    });
  } catch (error) {
    console.error("[indexDocumentVersion] failed", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * Bounded maintenance pass: indexes current versions that have no index
 * row yet, or are PENDING/FAILED. ADMIN-triggered only (see
 * lib/documents/template-actions.ts#reindexPendingDocuments).
 */
export async function reindexPending(limit = 50): Promise<number> {
  const versions = await prisma.documentVersion.findMany({
    where: {
      currentFor: { isNot: null },
      OR: [{ textIndex: { is: null } }, { textIndex: { status: { in: ["PENDING", "FAILED"] } } }],
    },
    select: { id: true },
    take: limit,
  });
  for (const v of versions) await indexDocumentVersion(v.id);
  return versions.length;
}
