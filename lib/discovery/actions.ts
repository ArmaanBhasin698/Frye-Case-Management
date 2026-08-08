"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { DiscoveryFileType } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import { documentStore } from "@/lib/storage/DocumentStore";
import { hashBuffer } from "@/lib/discovery/hash";
import {
  computeBatesRange,
  formatBatesRange,
  formatEvidenceIdentifier,
  nextBatesStart,
} from "@/lib/discovery/bates";
import { getPdfPageCount, stampBatesNumbers } from "@/lib/discovery/pdf";
import { compareProductionFiles } from "@/lib/discovery/compare";

/**
 * Server Actions for the Discovery/Bates engine: creating a production,
 * registering a file to it (hashing, Bates stamping or evidence-ID
 * assignment), and running a real comparison between two productions. Same
 * conventions as lib/matters/actions.ts: every action independently
 * re-checks authentication and matter-level access, validates input with
 * Zod, and returns a generic denial that can't be used to probe for the
 * existence of a matter/production/file the caller isn't authorized to see.
 */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const NOT_FOUND = { ok: false, error: "Not found or access denied." } satisfies ActionResult<never>;

export type FormActionState = { error: string | null };
const FORM_OK: FormActionState = { error: null };

const cuid = z.string().min(1, "Required.");
const DISCOVERY_FILE_TYPES = [
  "PDF",
  "VIDEO",
  "AUDIO",
  "PHOTO",
  "OTHER",
] as const satisfies readonly DiscoveryFileType[];

/** Generous for fictional/test files; this is a demo pipeline, not a real evidence-ingest system yet. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// --- Productions -----------------------------------------------------------

const createProductionSchema = z.object({
  matterId: cuid,
  label: z.string().trim().min(1, "Label is required.").max(200, "Label is too long."),
  source: z
    .string()
    .trim()
    .max(200, "Source is too long.")
    .optional()
    .transform((v) => (v ? v : undefined)),
  receivedDate: z
    .string()
    .min(1, "Received date is required.")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid received date."),
  batesPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .max(12, "Prefix is too long (12 characters max).")
    .regex(/^[A-Z0-9-]*$/, "Prefix may only contain letters, numbers, and hyphens.")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export async function createDiscoveryProduction(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const parsed = createProductionSchema.safeParse({
    matterId: formData.get("matterId"),
    label: formData.get("label"),
    source: formData.get("source") ?? undefined,
    receivedDate: formData.get("receivedDate"),
    batesPrefix: formData.get("batesPrefix") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, label, source, receivedDate, batesPrefix } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  const production = await prisma.discoveryProduction.create({
    data: { matterId, label, source, receivedDate: new Date(receivedDate), batesPrefix },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "DiscoveryProduction",
      entityId: production.id,
      matterId,
      metadata: { label, batesPrefix },
    },
  });

  revalidatePath(`/matters/${matterId}/discovery`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { ...FORM_OK };
}

// --- Files -------------------------------------------------------------

const registerFileSchema = z.object({
  matterId: cuid,
  productionId: cuid,
  fileType: z.enum(DISCOVERY_FILE_TYPES),
  file: z
    .instanceof(File, { message: "Select a file to register." })
    .refine((f) => f.size > 0, "The selected file is empty.")
    .refine((f) => f.size <= MAX_FILE_BYTES, "File is too large (25MB max for this demo)."),
});

export async function registerDiscoveryFile(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const parsed = registerFileSchema.safeParse({
    matterId: formData.get("matterId"),
    productionId: formData.get("productionId"),
    fileType: formData.get("fileType"),
    file: formData.get("file"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, productionId, fileType, file } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  // Scoped by matterId, same as every other matter-scoped write action —
  // a productionId from a different matter (even one the caller can
  // access) can never be registered against via this matter's page.
  const production = await prisma.discoveryProduction.findFirst({ where: { id: productionId, matterId } });
  if (!production) {
    return { error: NOT_FOUND.error };
  }

  const existingFiles = await prisma.discoveryFile.findMany({
    where: { productionId },
    select: { batesEnd: true },
  });

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = hashBuffer(buffer);
  const prefix = production.batesPrefix ?? "EV";
  const baseKey = `matters/${matterId}/discovery/${productionId}/${randomUUID()}`;

  let pageCount: number | null = null;
  let batesStart: number | null = null;
  let batesEnd: number | null = null;
  let stampedStorageKey: string | null = null;
  let identifier: string;

  if (fileType === "PDF") {
    let count: number;
    try {
      count = await getPdfPageCount(buffer);
    } catch {
      return { error: "Could not read this file as a PDF. Choose a valid PDF, or register it as a different file type." };
    }

    const start = nextBatesStart(
      existingFiles.map((f) => f.batesEnd).filter((n): n is number => n !== null),
      production.batesStart,
    );
    const range = computeBatesRange(start, count);
    const stamped = await stampBatesNumbers(buffer, { prefix, startNumber: start });

    stampedStorageKey = `${baseKey}/stamped.pdf`;
    await documentStore.save(stampedStorageKey, stamped);

    pageCount = count;
    batesStart = range.start;
    batesEnd = range.end;
    identifier = formatBatesRange(prefix, range.start, range.end);
  } else {
    identifier = formatEvidenceIdentifier(prefix, existingFiles.length + 1);
  }

  const originalStorageKey = `${baseKey}/original`;
  await documentStore.save(originalStorageKey, buffer);

  // Not a fully concurrency-safe increment (two simultaneous registrations
  // on the same production could both read the same production.batesStart/
  // batesEnd) — acceptable for a single-firm, low-concurrency demo; would
  // need a row lock (e.g. `SELECT ... FOR UPDATE`) to be airtight.
  const createdFile = await prisma.$transaction(async (tx) => {
    const created = await tx.discoveryFile.create({
      data: {
        productionId,
        originalFilename: file.name,
        identifier,
        fileType,
        contentHash,
        originalStorageKey,
        stampedStorageKey,
        pageCount,
        batesStart,
        batesEnd,
        sizeBytes: buffer.byteLength,
        mimeType: file.type || null,
        registeredById: user.id,
        registeredAt: new Date(),
      },
    });

    if (fileType === "PDF" && batesStart !== null && batesEnd !== null) {
      await tx.discoveryProduction.update({
        where: { id: productionId },
        data: {
          batesStart: production.batesStart ?? batesStart,
          batesEnd: Math.max(production.batesEnd ?? batesEnd, batesEnd),
        },
      });
    }

    return created;
  });

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "DiscoveryFile",
      entityId: createdFile.id,
      matterId,
      metadata: { fileType, originalFilename: createdFile.originalFilename, sizeBytes: createdFile.sizeBytes },
    },
  });

  if (fileType === "PDF") {
    // A distinct auditable event for Bates generation, separate from the
    // file-registration event above, per docs/SECURITY.md.
    await prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "DiscoveryFile",
        entityId: createdFile.id,
        matterId,
        metadata: { event: "bates_generated", prefix, batesStart, batesEnd, pageCount },
      },
    });
  }

  revalidatePath(`/matters/${matterId}/discovery`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { ...FORM_OK };
}

// --- Comparisons ---------------------------------------------------------

const runComparisonSchema = z
  .object({
    matterId: cuid,
    fromProductionId: cuid,
    toProductionId: cuid,
  })
  .refine((v) => v.fromProductionId !== v.toProductionId, {
    message: "Choose two different productions to compare.",
    path: ["toProductionId"],
  });

export async function runDiscoveryComparison(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await requireCurrentUser();

  const parsed = runComparisonSchema.safeParse({
    matterId: formData.get("matterId"),
    fromProductionId: formData.get("fromProductionId"),
    toProductionId: formData.get("toProductionId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { matterId, fromProductionId, toProductionId } = parsed.data;

  if (!(await hasMatterAccess(user, matterId))) {
    return { error: NOT_FOUND.error };
  }

  const [fromProduction, toProduction] = await Promise.all([
    prisma.discoveryProduction.findFirst({ where: { id: fromProductionId, matterId }, include: { files: true } }),
    prisma.discoveryProduction.findFirst({ where: { id: toProductionId, matterId }, include: { files: true } }),
  ]);
  if (!fromProduction || !toProduction) {
    return { error: NOT_FOUND.error };
  }

  const results = compareProductionFiles(fromProduction.files, toProduction.files, {
    fromLabel: fromProduction.label,
    toLabel: toProduction.label,
  });

  const comparison = await prisma.discoveryComparison.create({
    data: {
      matterId,
      fromProductionId,
      toProductionId,
      runById: user.id,
      matches: {
        create: results.map((r) => ({
          status: r.status,
          filename: r.filename,
          identifier: r.identifier,
          fileId: r.fileId,
          notes: r.notes,
        })),
      },
    },
  });

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "CREATE",
      entityType: "DiscoveryComparison",
      entityId: comparison.id,
      matterId,
      metadata: { fromProductionId, toProductionId, counts },
    },
  });

  revalidatePath(`/matters/${matterId}/discovery`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/timeline`);
  return { ...FORM_OK };
}
