"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { canEditMatter, hasMatterAccess } from "@/lib/auth/access";
import { requireCurrentUser } from "@/lib/auth/session";
import type { AuthorizableUser } from "@/lib/auth/authorization";
import { canViewContact } from "@/lib/contacts/visibility";
import { isContactOnMatter } from "@/lib/contacts/queries";
import { canAuthorProfessionalHistory } from "@/lib/history/visibility";
import {
  readClosureFields,
  readObservationFields,
  readRulingFields,
  rulingsAccountedFor,
  type ClosureFields,
  type RulingFields,
} from "@/lib/history/fields";

/**
 * Server Actions for professional history (rulings, observations) and the
 * structured matter-closure workflow. Every action re-checks the session,
 * matter access/editing rights, and contact visibility itself. Audit
 * metadata carries ids and enum values only — never ruling context,
 * observation text, outcome summaries, or notes.
 */

export type FormActionState = { error: string | null };
const NOT_FOUND = "Not found or access denied.";
const id = z.string().trim().min(1).max(100);

function revalidateHistory(matterId: string, contactIds: (string | null | undefined)[]) {
  revalidatePath(`/matters/${matterId}`);
  revalidatePath(`/matters/${matterId}/outcome`);
  for (const contactId of contactIds) if (contactId) revalidatePath(`/contacts/${contactId}`);
}

function isForeignKeyError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

/**
 * Shared ruling checks: the caller may edit the matter (ADMIN, or an
 * ATTORNEY on it), the judge is a JUDGE-category contact actually on that
 * matter, and any supporting document belongs to the same matter.
 */
async function validateRulingReferences(user: AuthorizableUser, fields: RulingFields): Promise<string | null> {
  if (!(await canEditMatter(user, fields.matterId))) return NOT_FOUND;
  const judge = await prisma.contact.findUnique({ where: { id: fields.judgeContactId }, select: { categories: true } });
  if (!judge || !judge.categories.includes("JUDGE") || !(await isContactOnMatter(fields.judgeContactId, fields.matterId))) {
    return "Choose a judge who is linked to this matter.";
  }
  if (fields.documentId) {
    const doc = await prisma.document.count({ where: { id: fields.documentId, matterId: fields.matterId } });
    if (doc === 0) return "Choose a document from this matter.";
  }
  return null;
}

function rulingData(fields: RulingFields) {
  return {
    matterId: fields.matterId,
    judgeContactId: fields.judgeContactId,
    rulingDate: new Date(fields.rulingDate),
    court: fields.court,
    proceedingType: fields.proceedingType,
    issueType: fields.issueType,
    issueDetail: fields.issueDetail ?? null,
    result: fields.result,
    context: fields.context ?? null,
    documentId: fields.documentId ?? null,
  };
}

export async function recordRuling(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = readRulingFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const fields = parsed.data;

  const referenceError = await validateRulingReferences(user, fields);
  if (referenceError) return { error: referenceError };

  const data = rulingData(fields);
  // The same ruling must never be recorded twice (e.g. once mid-case and
  // again during closure).
  const duplicate = await prisma.judicialRuling.count({
    where: {
      matterId: data.matterId,
      judgeContactId: data.judgeContactId,
      rulingDate: data.rulingDate,
      issueType: data.issueType,
      proceedingType: data.proceedingType,
      supersededAt: null,
    },
  });
  if (duplicate > 0) return { error: "This ruling is already recorded for this matter — correct the existing entry instead." };

  try {
    await prisma.$transaction(async (tx) => {
      const ruling = await tx.judicialRuling.create({ data: { ...data, recordedById: user.id } });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "JudicialRuling",
          entityId: ruling.id,
          matterId: data.matterId,
          metadata: { judgeContactId: data.judgeContactId, issueType: data.issueType, result: data.result, version: 1 },
        },
      });
    });
  } catch (error) {
    if (isForeignKeyError(error)) return { error: NOT_FOUND };
    throw error;
  }

  revalidateHistory(fields.matterId, [fields.judgeContactId]);
  return { error: null };
}

/**
 * Corrects a ruling by superseding it: the old row is kept (stamped
 * `supersededAt`) and a new version points back at it. Nothing is
 * overwritten.
 */
export async function correctRuling(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const rulingId = id.safeParse(formData.get("rulingId"));
  const reason = z.string().trim().min(1, "Explain the correction.").max(1_000).safeParse(formData.get("correctionReason") ?? "");
  if (!rulingId.success) return { error: NOT_FOUND };
  if (!reason.success) return { error: reason.error.issues[0]?.message ?? "Explain the correction." };

  const existing = await prisma.judicialRuling.findUnique({ where: { id: rulingId.data } });
  if (!existing || existing.supersededAt) return { error: NOT_FOUND };

  formData.set("matterId", existing.matterId);
  const parsed = readRulingFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const referenceError = await validateRulingReferences(user, parsed.data);
  if (referenceError) return { error: referenceError };

  const data = rulingData(parsed.data);
  await prisma.$transaction(async (tx) => {
    const superseded = await tx.judicialRuling.updateMany({
      where: { id: existing.id, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    if (superseded.count !== 1) throw new Error("Ruling was corrected concurrently.");
    const next = await tx.judicialRuling.create({
      data: {
        ...data,
        recordedById: user.id,
        closureReportId: existing.closureReportId,
        version: existing.version + 1,
        supersedesId: existing.id,
        correctionReason: reason.data,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "JudicialRuling",
        entityId: next.id,
        matterId: existing.matterId,
        metadata: { supersedes: existing.id, version: next.version, result: { before: existing.result, after: data.result } },
      },
    });
  });

  revalidateHistory(existing.matterId, [existing.judgeContactId, data.judgeContactId]);
  return { error: null };
}

async function validateObservationAccess(user: AuthorizableUser, subjectContactId: string, matterId: string | undefined) {
  if (!canAuthorProfessionalHistory(user)) return false;
  if (!(await canViewContact(user, subjectContactId))) return false;
  if (matterId && !(await hasMatterAccess(user, matterId))) return false;
  return true;
}

export async function recordObservation(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = readObservationFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const fields = parsed.data;
  if (!(await validateObservationAccess(user, fields.subjectContactId, fields.matterId))) return { error: NOT_FOUND };

  try {
    await prisma.$transaction(async (tx) => {
      const observation = await tx.professionalObservation.create({
        data: {
          subjectContactId: fields.subjectContactId,
          matterId: fields.matterId ?? null,
          authorId: user.id,
          category: fields.category,
          kind: fields.kind,
          body: fields.body,
          references: fields.references ?? null,
          shareScope: fields.shareScope,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "ProfessionalObservation",
          entityId: observation.id,
          matterId: fields.matterId ?? null,
          metadata: { subjectContactId: fields.subjectContactId, kind: fields.kind, shareScope: fields.shareScope, version: 1 },
        },
      });
    });
  } catch (error) {
    if (isForeignKeyError(error)) return { error: NOT_FOUND };
    throw error;
  }

  revalidatePath(`/contacts/${fields.subjectContactId}`);
  if (fields.matterId) revalidatePath(`/matters/${fields.matterId}/outcome`);
  return { error: null };
}

/** Only the author (or ADMIN) may correct an observation; the correction is a new version. */
export async function correctObservation(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const observationId = id.safeParse(formData.get("observationId"));
  const reason = z.string().trim().min(1, "Explain the correction.").max(1_000).safeParse(formData.get("correctionReason") ?? "");
  if (!observationId.success) return { error: NOT_FOUND };
  if (!reason.success) return { error: reason.error.issues[0]?.message ?? "Explain the correction." };

  const existing = await prisma.professionalObservation.findUnique({ where: { id: observationId.data } });
  if (!existing || existing.supersededAt) return { error: NOT_FOUND };
  if (existing.authorId !== user.id && user.role !== "ADMIN") return { error: NOT_FOUND };

  formData.set("subjectContactId", existing.subjectContactId);
  if (existing.matterId) formData.set("matterId", existing.matterId);
  const parsed = readObservationFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const fields = parsed.data;
  if (!(await validateObservationAccess(user, fields.subjectContactId, fields.matterId))) return { error: NOT_FOUND };

  await prisma.$transaction(async (tx) => {
    const superseded = await tx.professionalObservation.updateMany({
      where: { id: existing.id, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    if (superseded.count !== 1) throw new Error("Observation was corrected concurrently.");
    const next = await tx.professionalObservation.create({
      data: {
        subjectContactId: existing.subjectContactId,
        matterId: fields.matterId ?? null,
        authorId: existing.authorId,
        closureReportId: existing.closureReportId,
        category: fields.category,
        kind: fields.kind,
        body: fields.body,
        references: fields.references ?? null,
        shareScope: fields.shareScope,
        version: existing.version + 1,
        supersedesId: existing.id,
        correctionReason: reason.data,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "ProfessionalObservation",
        entityId: next.id,
        matterId: next.matterId,
        metadata: { supersedes: existing.id, version: next.version, shareScope: next.shareScope },
      },
    });
  });

  revalidatePath(`/contacts/${existing.subjectContactId}`);
  if (existing.matterId) revalidatePath(`/matters/${existing.matterId}/outcome`);
  return { error: null };
}

// --- Matter closure -------------------------------------------------------------

type ClosureMode = "close" | "amend" | "backfill";

/**
 * Validates everything a closure report references against the database:
 * edit rights on the matter, linked professionals actually on the matter
 * (and visible), and a responsible attorney who is a real ADMIN/ATTORNEY.
 */
async function validateClosureReferences(user: AuthorizableUser, fields: ClosureFields): Promise<string | null> {
  if (!(await canEditMatter(user, fields.matterId))) return NOT_FOUND;
  for (const contactId of [fields.judgeContactId, fields.prosecutorContactId, fields.opposingCounselContactId]) {
    if (contactId && (!(await canViewContact(user, contactId)) || !(await isContactOnMatter(contactId, fields.matterId)))) {
      return "Linked judge, prosecutor, and opposing counsel must be contacts on this matter.";
    }
  }
  if (fields.responsibleAttorneyId) {
    const attorney = await prisma.user.count({
      where: { id: fields.responsibleAttorneyId, role: { in: ["ADMIN", "ATTORNEY"] } },
    });
    if (attorney === 0) return "Choose an attorney as the responsible attorney.";
  }
  return null;
}

/** Closing-time observations about the judge / prosecutor / opposing counsel, optional. */
function readClosureObservations(formData: FormData, fields: ClosureFields) {
  const slots = [
    { prefix: "judgeObs_", contactId: fields.judgeContactId },
    { prefix: "prosecutorObs_", contactId: fields.prosecutorContactId },
    { prefix: "opposingObs_", contactId: fields.opposingCounselContactId },
  ];
  const results: { error?: string; data?: ReturnType<typeof readObservationFields> }[] = [];
  for (const slot of slots) {
    const body = String(formData.get(`${slot.prefix}body`) ?? "").trim();
    if (!body) continue;
    if (!slot.contactId) {
      results.push({ error: "An observation needs the matching judge, prosecutor, or opposing counsel selected." });
      continue;
    }
    formData.set(`${slot.prefix}subjectContactId`, slot.contactId);
    formData.set(`${slot.prefix}matterId`, fields.matterId);
    if (!formData.get(`${slot.prefix}category`)) formData.set(`${slot.prefix}category`, "OTHER");
    if (!formData.get(`${slot.prefix}kind`)) formData.set(`${slot.prefix}kind`, "PROCEDURAL_OBSERVATION");
    results.push({ data: readObservationFields(formData, slot.prefix) });
  }
  return results;
}

async function submitClosure(mode: ClosureMode, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const parsed = readClosureFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const fields = parsed.data;

  const referenceError = await validateClosureReferences(user, fields);
  if (referenceError) return { error: referenceError };

  const matter = await prisma.matter.findUnique({
    where: { id: fields.matterId },
    select: { id: true, status: true, openedDate: true, closureReviewStatus: true },
  });
  if (!matter) return { error: NOT_FOUND };
  const current = await prisma.matterClosureReport.findFirst({
    where: { matterId: matter.id, supersededAt: null },
    orderBy: { version: "desc" },
  });
  const latestVersion = await prisma.matterClosureReport.aggregate({ where: { matterId: matter.id }, _max: { version: true } });

  if (mode === "close" && matter.status === "CLOSED") return { error: "This matter is already closed." };
  if (mode === "backfill" && (matter.status !== "CLOSED" || current)) {
    return { error: "Backfill is only for closed matters that have no closure report yet." };
  }
  if (mode === "amend") {
    if (!current || matter.status !== "CLOSED") return { error: "There is no current closure report to amend." };
    if (!fields.amendmentReason) return { error: "Explain why the report is being amended." };
  }
  if (new Date(fields.closureDate) < matter.openedDate) return { error: "Closure date can't be before the matter was opened." };

  const rulingCount = await prisma.judicialRuling.count({ where: { matterId: matter.id, supersededAt: null } });
  if (!rulingsAccountedFor(fields, rulingCount)) {
    return {
      error:
        "Record the significant rulings first, confirm there were none, or document an exception (e.g. incomplete historical records).",
    };
  }

  const observations = readClosureObservations(formData, fields);
  for (const o of observations) {
    if (o.error) return { error: o.error };
    if (o.data && !o.data.success) return { error: o.data.error.issues[0]?.message ?? "Invalid observation." };
  }

  const version = (latestVersion._max.version ?? 0) + 1;
  const closureDate = new Date(fields.closureDate);

  await prisma.$transaction(async (tx) => {
    if (current) {
      await tx.matterClosureReport.update({ where: { id: current.id }, data: { supersededAt: new Date() } });
    }
    const report = await tx.matterClosureReport.create({
      data: {
        matterId: matter.id,
        version,
        amendmentReason: mode === "amend" ? (fields.amendmentReason ?? null) : null,
        isHistoricalBackfill: mode === "backfill" || Boolean(current?.isHistoricalBackfill && mode === "amend"),
        responsibleAttorneyId: fields.responsibleAttorneyId ?? null,
        closingAttorneyId: user.id,
        closureDate,
        caseType: fields.caseType ?? null,
        charges: fields.charges,
        disposition: fields.disposition,
        dispositionDetail: fields.dispositionDetail ?? null,
        outcomeDate: fields.outcomeDate ? new Date(fields.outcomeDate) : null,
        resolutionProcedure: fields.resolutionProcedure,
        outcomeSummary: fields.outcomeSummary,
        judgeContactId: fields.judgeContactId ?? null,
        prosecutorContactId: fields.prosecutorContactId ?? null,
        opposingCounselContactId: fields.opposingCounselContactId ?? null,
        noSignificantRulings: fields.noSignificantRulings,
        exceptionReason: fields.exceptionReason ?? null,
        finalNotes: fields.finalNotes ?? null,
        lessonsLearned: fields.lessonsLearned ?? null,
        trialOutcome:
          fields.resolutionProcedure === "TRIAL" && fields.trial
            ? {
                create: {
                  trialStartDate: new Date(fields.trial.trialStartDate),
                  trialEndDate: fields.trial.trialEndDate ? new Date(fields.trial.trialEndDate) : null,
                  trialType: fields.trial.trialType,
                  defenseAttorneys: fields.trial.defenseAttorneys ?? null,
                  chargesTried: fields.trial.chargesTried,
                  verdicts: fields.trial.verdicts,
                  evidentiaryIssues: fields.trial.evidentiaryIssues ?? null,
                  significantMotions: fields.trial.significantMotions ?? null,
                  sentencingOutcome: fields.trial.sentencingOutcome ?? null,
                  trialSummary: fields.trial.trialSummary,
                  attorneyObservations: fields.trial.attorneyObservations ?? null,
                  lessonsLearned: fields.trial.lessonsLearned ?? null,
                },
              }
            : undefined,
      },
    });

    // Link the matter's structured rulings to the report that accounts for
    // them. The rulings themselves stay where they are — attached to the
    // matter and the judge — so the judge's history picks them up by
    // reference, never by copy.
    await tx.judicialRuling.updateMany({
      where: { matterId: matter.id, supersededAt: null },
      data: { closureReportId: report.id },
    });

    for (const o of observations) {
      if (!o.data?.success) continue;
      const obs = o.data.data;
      const created = await tx.professionalObservation.create({
        data: {
          subjectContactId: obs.subjectContactId,
          matterId: obs.matterId ?? null,
          authorId: user.id,
          category: obs.category,
          kind: obs.kind,
          body: obs.body,
          references: obs.references ?? null,
          shareScope: obs.shareScope,
          closureReportId: report.id,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "CREATE",
          entityType: "ProfessionalObservation",
          entityId: created.id,
          matterId: created.matterId,
          metadata: { subjectContactId: obs.subjectContactId, kind: obs.kind, shareScope: obs.shareScope, viaClosure: true },
        },
      });
    }

    await tx.matter.update({
      where: { id: matter.id },
      data: { status: "CLOSED", closedDate: closureDate, closureReviewStatus: "COMPLETE" },
    });

    await tx.auditEvent.create({
      data: {
        actorId: user.id,
        action: mode === "close" ? "CREATE" : "UPDATE",
        entityType: "MatterClosureReport",
        entityId: report.id,
        matterId: matter.id,
        metadata: {
          mode,
          version,
          disposition: fields.disposition,
          resolutionProcedure: fields.resolutionProcedure,
          trialReport: fields.resolutionProcedure === "TRIAL",
          linkedRulings: rulingCount,
          ...(current ? { supersedes: current.id } : {}),
        },
      },
    });
    if (mode === "close") {
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "UPDATE",
          entityType: "Matter",
          entityId: matter.id,
          matterId: matter.id,
          metadata: { changed: { status: { before: matter.status, after: "CLOSED" } }, viaClosureReport: report.id },
        },
      });
    }
  });

  revalidateHistory(matter.id, [fields.judgeContactId, fields.prosecutorContactId, fields.opposingCounselContactId]);
  revalidatePath("/matters");
  return { error: null };
}

export async function closeMatter(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  return submitClosure("close", formData);
}

export async function amendClosureReport(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  return submitClosure("amend", formData);
}

export async function backfillClosureReport(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  return submitClosure("backfill", formData);
}

/**
 * Reopening is an explicit, audited action. The closure reports stay as
 * history; closing again later creates the next version.
 */
export async function reopenMatter(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const user = await requireCurrentUser();
  const matterId = id.safeParse(formData.get("matterId"));
  const reason = z.string().trim().min(1, "Explain why the matter is being reopened.").max(1_000).safeParse(formData.get("reason") ?? "");
  if (!matterId.success || !(await canEditMatter(user, matterId.data))) return { error: NOT_FOUND };
  if (!reason.success) return { error: reason.error.issues[0]?.message ?? "Explain why." };

  const matter = await prisma.matter.findUnique({ where: { id: matterId.data }, select: { status: true } });
  if (!matter) return { error: NOT_FOUND };
  if (matter.status !== "CLOSED") return { error: "Only a closed matter can be reopened." };

  await prisma.$transaction([
    prisma.matter.update({
      where: { id: matterId.data },
      data: { status: "OPEN", closedDate: null, closureReviewStatus: "NOT_APPLICABLE" },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: "UPDATE",
        entityType: "Matter",
        entityId: matterId.data,
        matterId: matterId.data,
        metadata: { changed: { status: { before: "CLOSED", after: "OPEN" } }, reopened: true },
      },
    }),
  ]);

  revalidateHistory(matterId.data, []);
  revalidatePath("/matters");
  return { error: null };
}
